"use client";

import { ChevronDown, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { requestFormDirtyReevaluation } from "@/components/form-dirty-state";
import {
  breedMatchesQuery,
  findExactBreed,
  type BreedOption
} from "@/lib/breed-search";

type BreedComboboxProps = {
  breeds: BreedOption[];
  species: "DOG" | "CAT" | "";
  initialBreedId?: string | null;
  initialBreedName?: string | null;
  initialCustomBreedName?: string | null;
  disabled?: boolean;
};

type Candidate =
  | { kind: "master"; breed: BreedOption }
  | { kind: "custom"; value: string };

/**
 * Petのspeciesに対応する有効なマスタ候補と自由入力を、排他的なhidden値へ変換する。
 * 無効化済みマスタは初期表示には残すが、新しい候補としては受け付けない。
 */
export function BreedCombobox({
  breeds,
  species,
  initialBreedId = null,
  initialBreedName = null,
  initialCustomBreedName = null,
  disabled = false
}: BreedComboboxProps) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const initialText = initialBreedName ?? initialCustomBreedName ?? "";
  const [query, setQuery] = useState(initialText);
  const [breedId, setBreedId] = useState(initialBreedId ?? "");
  const [customBreedName, setCustomBreedName] = useState(initialCustomBreedName ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const speciesBreeds = useMemo(
    () => breeds.filter((breed) => breed.species === species),
    [breeds, species]
  );
  const exactBreed = useMemo(() => findExactBreed(speciesBreeds, query), [query, speciesBreeds]);
  const matchingBreeds = useMemo(() => {
    const matched = query.trim()
      ? speciesBreeds.filter((breed) => breedMatchesQuery(breed, query))
      : [
          ...speciesBreeds.filter((breed) => breed.isPopular),
          ...speciesBreeds.filter((breed) => !breed.isPopular)
        ];
    return matched.slice(0, 80);
  }, [query, speciesBreeds]);
  const candidates = useMemo<Candidate[]>(() => {
    const choices: Candidate[] = matchingBreeds.map((breed) => ({ kind: "master", breed }));
    const trimmed = query.trim();
    if (trimmed && !exactBreed) choices.unshift({ kind: "custom", value: trimmed });
    return choices;
  }, [exactBreed, matchingBreeds, query]);

  useEffect(() => {
    requestFormDirtyReevaluation(wrapperRef.current?.closest("form") ?? null);
  }, [breedId, customBreedName]);

  function chooseMaster(breed: BreedOption) {
    setQuery(breed.nameJa);
    setBreedId(breed.id);
    setCustomBreedName("");
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function chooseCustom(value: string) {
    setQuery(value);
    setBreedId("");
    setCustomBreedName(value.trim());
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function clearChoice() {
    setQuery("");
    setBreedId("");
    setCustomBreedName("");
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleQueryChange(value: string) {
    const exact = findExactBreed(speciesBreeds, value);
    setQuery(value);
    setBreedId(exact?.id ?? "");
    setCustomBreedName(exact ? "" : value.trim());
    setIsOpen(true);
    setActiveIndex(-1);
  }

  function chooseCandidate(candidate: Candidate | undefined) {
    if (!candidate) return;
    if (candidate.kind === "master") chooseMaster(candidate.breed);
    else chooseCustom(candidate.value);
  }

  if (disabled) {
    return (
      <div className="grid gap-1 text-sm font-medium text-slate-700">
        <label htmlFor={inputId}>
          品種
          <span className="ml-1 text-xs font-normal text-slate-500">（任意）</span>
        </label>
        <input id={inputId} className="h-10" value={initialText} readOnly />
      </div>
    );
  }

  return (
    <div className="grid gap-1 text-sm font-medium text-slate-700">
      <label htmlFor={inputId}>
        品種
        <span className="ml-1 text-xs font-normal text-slate-500">（任意）</span>
      </label>
      <div
        ref={wrapperRef}
        className="relative min-w-0"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
        }}
      >
        <input type="hidden" name="breedId" value={breedId} data-dirty-control />
        <input type="hidden" name="customBreedName" value={customBreedName} data-dirty-control />
        <input
          id={inputId}
          className="h-10 pr-16"
          value={query}
          maxLength={100}
          placeholder={species ? "品種を検索または入力" : "先に種類を選択"}
          disabled={!species}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          onFocus={() => setIsOpen(Boolean(species))}
          onChange={(event) => handleQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) => Math.min(current + 1, candidates.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter" && isOpen && activeIndex >= 0) {
              event.preventDefault();
              chooseCandidate(candidates[activeIndex]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setIsOpen(false);
              setActiveIndex(-1);
            }
          }}
        />
        {query ? (
          <button
            type="button"
            aria-label="品種をクリア"
            className="absolute right-8 top-0 inline-flex h-10 w-8 items-center justify-center text-slate-500 hover:text-slate-700"
            onClick={clearChoice}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          tabIndex={-1}
          aria-label="品種候補を開く"
          className="absolute right-0 top-0 inline-flex h-10 w-9 items-center justify-center text-slate-500"
          onClick={() => setIsOpen((current) => !current)}
        >
          <ChevronDown className="h-4 w-4" aria-hidden />
        </button>

        {isOpen ? (
          <div
            id={listboxId}
            role="listbox"
            className="absolute z-30 mt-1 max-h-72 w-full min-w-0 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          >
            {!query.trim() && matchingBreeds.some((breed) => breed.isPopular) ? (
              <p className="px-3 py-1 text-xs font-semibold text-slate-500">よく選ばれる品種</p>
            ) : null}
            {candidates.map((candidate, index) => {
              const label = candidate.kind === "master"
                ? candidate.breed.nameJa
                : `「${candidate.value}」を直接入力`;
              const selected = candidate.kind === "master" && candidate.breed.id === breedId;
              const firstRegular = !query.trim() && candidate.kind === "master" && !candidate.breed.isPopular &&
                !matchingBreeds.slice(0, matchingBreeds.indexOf(candidate.breed)).some((breed) => !breed.isPopular);
              return (
                <div key={candidate.kind === "master" ? candidate.breed.id : `custom-${candidate.value}`}>
                  {firstRegular ? <p className="border-t border-slate-100 px-3 pb-1 pt-2 text-xs font-semibold text-slate-500">すべての品種</p> : null}
                  <button
                    id={`${listboxId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`block w-full px-3 py-2 text-left text-sm ${
                      index === activeIndex ? "bg-highlight/50" : "hover:bg-slate-50"
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseCandidate(candidate)}
                  >
                    <span className="block text-slate-800">{label}</span>
                    {candidate.kind === "master" && candidate.breed.nameEn ? (
                      <span className="block text-xs text-slate-500">{candidate.breed.nameEn}</span>
                    ) : null}
                  </button>
                </div>
              );
            })}
            {candidates.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-500">該当する品種はありません。</p>
            ) : null}
            {!query.trim() && speciesBreeds.length > matchingBreeds.length ? (
              <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">品種名を入力すると、さらに候補を絞り込めます。</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function PetCreateSpeciesBreedFields({ breeds }: { breeds: BreedOption[] }) {
  const [species, setSpecies] = useState<"DOG" | "CAT" | "">("");

  return (
    <div className="contents">
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        種類
        <select
          className="h-10"
          name="species"
          required
          value={species}
          onChange={(event) => setSpecies(event.target.value as "DOG" | "CAT" | "")}
        >
          <option value="" disabled>選択してください</option>
          <option value="DOG">犬</option>
          <option value="CAT">猫</option>
        </select>
      </label>
      <BreedCombobox key={species || "unset"} breeds={breeds} species={species} />
    </div>
  );
}
