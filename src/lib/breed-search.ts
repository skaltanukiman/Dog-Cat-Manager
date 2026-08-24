export type BreedOption = {
  id: string;
  species: "DOG" | "CAT";
  nameJa: string;
  nameKana: string | null;
  nameEn: string | null;
  isPopular: boolean;
  sortOrder: number;
};

const SEARCH_IGNORED_CHARACTERS = /[\s\u3000・･\-‐‑‒–—―−]/g;

/** 表記差だけを吸収し、曖昧一致へ広げず品種検索と完全一致判定を共通化する。 */
export function normalizeBreedSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[ぁ-ゖ]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 0x60))
    .replace(SEARCH_IGNORED_CHARACTERS, "");
}

export function breedMatchesQuery(breed: BreedOption, query: string) {
  const normalizedQuery = normalizeBreedSearch(query);
  if (!normalizedQuery) return true;
  return [breed.nameJa, breed.nameKana, breed.nameEn]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizeBreedSearch(value).includes(normalizedQuery));
}

export function findExactBreed(breeds: BreedOption[], query: string) {
  const normalizedQuery = normalizeBreedSearch(query);
  if (!normalizedQuery) return undefined;
  return breeds.find((breed) =>
    [breed.nameJa, breed.nameKana, breed.nameEn]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalizeBreedSearch(value) === normalizedQuery)
  );
}
