"use server";

import { redirect } from "next/navigation";

import { belongsToCurrentHousehold } from "@/lib/authorization";
import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { activityActorName } from "@/lib/household-activity";
import { getDaysInMonth, isFutureDateInput, parseDateInput, toDateInputValue } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { commitHouseholdMutation, getRealtimeActorId, publishHouseholdChangeSafely } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { cleaningMonthSchema } from "@/lib/schemas";
import { handleServerActionError } from "@/lib/server-errors";

type CleaningDayData = {
  toiletCleaned: boolean;
  bathCleaned: boolean;
  flooringPartCleaned: boolean;
  flooringAllCleaned: boolean;
  houseCleaned: boolean;
  memo: string | null;
};

function isSameCleaningData(existing: CleaningDayData, submitted: CleaningDayData) {
  return (
    existing.toiletCleaned === submitted.toiletCleaned &&
    existing.bathCleaned === submitted.bathCleaned &&
    existing.flooringPartCleaned === submitted.flooringPartCleaned &&
    existing.flooringAllCleaned === submitted.flooringAllCleaned &&
    existing.houseCleaned === submitted.houseCleaned &&
    existing.memo === submitted.memo
  );
}

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getChecked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function cleaningRedirect(hamsterId: string, yearMonth: string, status: string, includeInactive: boolean) {
  const params = new URLSearchParams({
    hamsterId,
    month: yearMonth,
    status
  });

  if (includeInactive) {
    params.set("includeInactive", "1");
  }

  redirect(`/cleaning?${params.toString()}`);
}

/**
 * 指定月の衛生記録を、フォーム全体のスナップショットとして保存するServer Action。
 *
 * 未来日は送信値を拒否したうえで更新対象外にし、空になった日は削除、変更のある日だけを
 * 作成・更新する。月の変更件数と操作履歴、revisionは同一transactionで確定する。
 */
export async function saveCleaningMonth(formData: FormData) {
  const includeInactive = formData.get("includeInactive") === "1";
  try {
    const context = await getRequiredHouseholdMutationContext("/cleaning");
    const result = cleaningMonthSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) redirect("/cleaning?status=invalid");

    const { hamsterId, yearMonth } = result.data;
    const hamster = await prisma.hamster.findUnique({
      where: { id: hamsterId },
      select: { householdId: true, isActive: true, name: true }
    });
    if (!hamster || !belongsToCurrentHousehold(hamster.householdId, context.household.id)) {
      redirect("/cleaning?status=invalid");
    }
    if (!hamster.isActive) cleaningRedirect(hamsterId, yearMonth, "locked", includeInactive);

    const days = getDaysInMonth(yearMonth);
    const hasFutureInput = days.some((day) =>
      isFutureDateInput(day.date)
        ? getChecked(formData, `toilet_${day.date}`) ||
          getChecked(formData, `bath_${day.date}`) ||
          getChecked(formData, `flooring_part_${day.date}`) ||
          getChecked(formData, `flooring_all_${day.date}`) ||
          getChecked(formData, `house_${day.date}`) ||
          Boolean(getText(formData, `memo_${day.date}`))
        : false
    );
    if (hasFutureInput) cleaningRedirect(hamsterId, yearMonth, "future", includeInactive);

    // 未来日は保存対象外とし、送信されないチェックボックスを空データと誤認しない。
    const editableDays = days.filter((day) => !isFutureDateInput(day.date));
    if (editableDays.length === 0) cleaningRedirect(hamsterId, yearMonth, "future", includeInactive);

    const submittedDays = editableDays.map((day) => {
      const memo = getText(formData, `memo_${day.date}`) || null;
      const data = {
        toiletCleaned: getChecked(formData, `toilet_${day.date}`),
        bathCleaned: getChecked(formData, `bath_${day.date}`),
        flooringPartCleaned: getChecked(formData, `flooring_part_${day.date}`),
        flooringAllCleaned: getChecked(formData, `flooring_all_${day.date}`),
        houseCleaned: getChecked(formData, `house_${day.date}`),
        memo
      };
      return {
        date: day.date,
        recordDate: parseDateInput(day.date),
        data,
        hasRecord: Object.values(data).some(Boolean)
      };
    });

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "cleaning",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const existingRecords = await tx.cleaningRecord.findMany({
          where: { hamsterId, recordDate: { in: submittedDays.map((day) => day.recordDate) } },
          select: {
            id: true,
            recordDate: true,
            toiletCleaned: true,
            bathCleaned: true,
            flooringPartCleaned: true,
            flooringAllCleaned: true,
            houseCleaned: true,
            memo: true
          }
        });
        const existingByDate = new Map(existingRecords.map((record) => [toDateInputValue(record.recordDate), record]));
        // 月全体の送信でも、空行は残さず、実際に差分がある日だけを更新する。
        const operations = submittedDays.flatMap((day) => {
          const existing = existingByDate.get(day.date);
          if (!day.hasRecord) {
            return existing ? [tx.cleaningRecord.delete({ where: { id: existing.id } })] : [];
          }
          if (existing) {
            return isSameCleaningData(existing, day.data)
              ? []
              : [tx.cleaningRecord.update({ where: { id: existing.id }, data: day.data })];
          }
          return [tx.cleaningRecord.create({ data: { hamsterId, recordDate: day.recordDate, ...day.data } })];
        });
        if (operations.length === 0) cleaningRedirect(hamsterId, yearMonth, "unchanged", includeInactive);
        await Promise.all(operations);
        return operations.length;
      },
      activity: (changedDayCount) => ({
        eventType: "CLEANING_MONTH_SAVED",
        category: "CARE_RECORD",
        targetType: "HAMSTER",
        targetId: hamsterId,
        targetNameSnapshot: hamster.name,
        details: { yearMonth, changedDayCount }
      })
    });

    publishHouseholdChangeSafely(change);
    revalidatePathsSafely([{ path: "/" }, { path: "/cleaning" }, { path: "/settings/members" }, { path: "/settings/members/activity" }], "cleaning.saveMonth.revalidate", {
      householdId: context.household.id,
      hamsterId
    });
    cleaningRedirect(hamsterId, yearMonth, "saved", includeInactive);
  } catch (error) {
    const params = new URLSearchParams();
    const hamsterId = formData.get("hamsterId");
    const yearMonth = formData.get("yearMonth");
    if (typeof hamsterId === "string") params.set("hamsterId", hamsterId);
    if (typeof yearMonth === "string") params.set("month", yearMonth);
    if (includeInactive) params.set("includeInactive", "1");
    handleServerActionError(error, { operation: "cleaning.saveMonth", pathname: "/cleaning", searchParams: params });
  }
}
