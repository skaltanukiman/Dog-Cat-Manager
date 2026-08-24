export type BreedSeed = {
  species: "DOG" | "CAT";
  nameJa: string;
  nameKana: string | null;
  nameEn: string | null;
  isPopular: boolean;
  sortOrder: number;
  isActive: boolean;
};

function katakanaToHiragana(value: string) {
  return value.replace(/[ァ-ヶ]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0x60)
  );
}

export function buildBreedSeeds(
  species: BreedSeed["species"],
  names: readonly string[],
  options: {
    popular: readonly string[];
    english?: Readonly<Record<string, string>>;
    kana?: Readonly<Record<string, string>>;
  }
) {
  return names.map<BreedSeed>((nameJa, index) => {
    const generatedKana = katakanaToHiragana(nameJa);
    const popularIndex = options.popular.indexOf(nameJa);
    return {
      species,
      nameJa,
      nameKana: options.kana?.[nameJa] ?? (generatedKana !== nameJa ? generatedKana : null),
      nameEn: options.english?.[nameJa] ?? null,
      isPopular: popularIndex >= 0,
      sortOrder: popularIndex >= 0 ? popularIndex : 1000 + index,
      isActive: true
    };
  });
}
