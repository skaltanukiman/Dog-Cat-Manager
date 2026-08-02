import { revalidatePath } from "next/cache";

import { logUnexpectedError } from "@/lib/server-errors";

type RevalidateTarget = {
  path: string;
  type?: "layout" | "page";
};

/**
 * commit後のcache再検証を、対象ごとに独立して試行する。
 *
 * 再検証失敗で確定済みの業務更新を失敗扱いにせず、エラーを記録して残りも続行する。
 * DB transaction内では呼び出さないこと。
 */
export function revalidatePathsSafely(
  targets: RevalidateTarget[],
  operation: string,
  context?: Record<string, string | number | boolean | null | undefined>
) {
  for (const target of targets) {
    try {
      if (target.type) {
        revalidatePath(target.path, target.type);
      } else {
        revalidatePath(target.path);
      }
    } catch (error) {
      logUnexpectedError(error, {
        operation,
        context: {
          ...context,
          revalidatePath: target.path
        }
      });
    }
  }
}
