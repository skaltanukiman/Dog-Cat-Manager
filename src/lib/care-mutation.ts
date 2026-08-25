/** Care画面の成功時にClientへ返す、画面遷移を伴わないMutation結果。 */
export type CareMutationStatus =
  | "petFeedingCreated"
  | "petFeedingUpdated"
  | "petFeedingDeleted"
  | "petWaterCreated"
  | "petWaterUpdated"
  | "petWaterDeleted"
  | "petWalkCreated"
  | "petWalkUpdated"
  | "petWalkDeleted"
  | "petLitterCreated"
  | "petLitterUpdated"
  | "petLitterDeleted";

export type CareMutationResult = {
  success: true;
  status: CareMutationStatus;
};

export const CARE_MUTATION_SUCCESS_MESSAGES: Record<CareMutationStatus, string> = {
  petFeedingCreated: "食事を記録しました。",
  petFeedingUpdated: "食事を更新しました。",
  petFeedingDeleted: "食事記録を削除しました。",
  petWaterCreated: "水のお世話を記録しました。",
  petWaterUpdated: "水のお世話を更新しました。",
  petWaterDeleted: "水の記録を削除しました。",
  petWalkCreated: "散歩を記録しました。",
  petWalkUpdated: "散歩記録を更新しました。",
  petWalkDeleted: "散歩記録を削除しました。",
  petLitterCreated: "猫トイレを記録しました。",
  petLitterUpdated: "猫トイレ記録を更新しました。",
  petLitterDeleted: "猫トイレ記録を削除しました。"
};
