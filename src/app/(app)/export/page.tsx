import { redirect } from "next/navigation";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ExportPage({
  searchParams
}: {
  searchParams: Promise<{ hamsterId?: string | string[]; month?: string | string[]; status?: string | string[] }>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams();
  const hamsterId = getParam(query.hamsterId);
  const month = getParam(query.month);
  const status = getParam(query.status);

  if (hamsterId) {
    params.set("hamsterId", hamsterId);
  }

  if (month) {
    params.set("month", month);
  }

  if (status) {
    params.set("status", status);
  }

  redirect(`/weights/export${params.toString() ? `?${params}` : ""}`);
}
