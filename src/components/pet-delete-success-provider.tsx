"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { AutoDismissSuccessMessage } from "@/components/status-message";

type PetDeleteSuccessContextValue = {
  showPetDeleted: (petName: string) => void;
};

const PetDeleteSuccessContext = createContext<PetDeleteSuccessContextValue | null>(null);

/** Pet削除後も一覧の再描画で消えない位置に、DBで確定した名前の成功通知を表示する。 */
export function PetDeleteSuccessProvider({ children }: { children: ReactNode }) {
  const [success, setSuccess] = useState<{ key: number; petName: string } | null>(null);

  function showPetDeleted(petName: string) {
    setSuccess((current) => ({ key: (current?.key ?? 0) + 1, petName }));
  }

  return (
    <PetDeleteSuccessContext.Provider value={{ showPetDeleted }}>
      {success ? <AutoDismissSuccessMessage key={success.key} message={`${success.petName}を完全に削除しました。`} /> : null}
      {children}
    </PetDeleteSuccessContext.Provider>
  );
}

export function usePetDeleteSuccess() {
  const context = useContext(PetDeleteSuccessContext);
  if (!context) throw new Error("PetDeleteSuccessProvider が必要です。");
  return context;
}
