"use client";

import { Plus } from "lucide-react";
import { startTransition, useActionState, useState, type FormEvent } from "react";

import {
  createPet,
  type PetCreateActionState
} from "@/app/actions/pets";
import { PetCreateSpeciesBreedFields } from "@/components/breed-combobox";
import { PetImageField } from "@/components/pet-image-field";
import { StatusMessage } from "@/components/status-message";
import type { BreedOption } from "@/lib/breed-search";

type PetCreateFormValues = {
  name: string;
  sex: "MALE" | "FEMALE" | "UNKNOWN";
  birthDate: string;
  adoptionDate: string;
  memo: string;
};

const INITIAL_VALUES: PetCreateFormValues = {
  name: "",
  sex: "UNKNOWN",
  birthDate: "",
  adoptionDate: "",
  memo: ""
};

const INITIAL_ACTION_STATE: PetCreateActionState = {
  submissionId: 0,
  status: null
};

/**
 * 作成エラー時は同じフォームDOMとClient stateを維持し、修正後の再送信を可能にする。
 * 成功時はServer Actionが従来の完了URLへredirectするため、次のフォームは初期値で生成される。
 */
export function PetCreateForm({ breeds, today }: { breeds: BreedOption[]; today: string }) {
  const [values, setValues] = useState<PetCreateFormValues>(INITIAL_VALUES);
  const [state, action, pending] = useActionState(createPet, INITIAL_ACTION_STATE);

  function updateValue<Field extends keyof PetCreateFormValues>(
    field: Field,
    value: PetCreateFormValues[Field]
  ) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-dirty-watch
      aria-busy={pending}
      className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4"
    >
      {state.status ? (
        <div key={state.submissionId} className="md:col-span-2 lg:col-span-4">
          <StatusMessage status={state.status} />
        </div>
      ) : null}
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        名前
        <input
          className="h-10"
          name="name"
          required
          maxLength={15}
          placeholder="例: こむぎ"
          value={values.name}
          onChange={(event) => updateValue("name", event.currentTarget.value)}
        />
      </label>
      <PetCreateSpeciesBreedFields breeds={breeds} />
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        <span>
          性別
          <span className="ml-1 text-xs font-normal text-slate-500">（任意）</span>
        </span>
        <select
          className="h-10"
          name="sex"
          value={values.sex}
          onChange={(event) => updateValue("sex", event.currentTarget.value as PetCreateFormValues["sex"])}
        >
          <option value="MALE">オス</option>
          <option value="FEMALE">メス</option>
          <option value="UNKNOWN">不明</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        <span>
          誕生日
          <span className="ml-1 text-xs font-normal text-slate-500">（任意）</span>
        </span>
        <input
          className="h-10"
          type="date"
          name="birthDate"
          max={today}
          value={values.birthDate}
          onChange={(event) => updateValue("birthDate", event.currentTarget.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        <span>
          お迎え日
          <span className="ml-1 text-xs font-normal text-slate-500">（任意）</span>
        </span>
        <input
          className="h-10"
          type="date"
          name="adoptionDate"
          max={today}
          value={values.adoptionDate}
          onChange={(event) => updateValue("adoptionDate", event.currentTarget.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-700 md:col-span-2 lg:col-span-2">
        <span>
          メモ
          <span className="ml-1 text-xs font-normal text-slate-500">（任意）</span>
        </span>
        <input
          className="h-10"
          name="memo"
          maxLength={2000}
          placeholder="性格、注意点など"
          value={values.memo}
          onChange={(event) => updateValue("memo", event.currentTarget.value)}
        />
      </label>
      <div className="md:col-span-2 lg:col-span-4">
        <PetImageField petName="新しいPet" />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-wait disabled:bg-slate-300 md:col-span-2 lg:col-span-4 lg:justify-self-end"
      >
        <Plus className="h-4 w-4" aria-hidden />
        {pending ? "登録中…" : "登録"}
      </button>
    </form>
  );
}
