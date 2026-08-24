"use client";

import { useEffect } from "react";

import { useTutorial } from "@/components/tutorial-provider";

/** Pet作成成功後のServer renderを、進行中の初回ガイドへ通知する。 */
export function TutorialPetCreatedBridge({ petId }: { petId: string }) {
  const { notifyPetCreated } = useTutorial();

  useEffect(() => {
    notifyPetCreated(petId);
  }, [notifyPetCreated, petId]);

  return null;
}
