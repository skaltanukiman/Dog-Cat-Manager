type PetSpeciesBadgeProps = {
  species: "DOG" | "CAT";
};

const speciesLabels = {
  DOG: "犬",
  CAT: "猫"
} as const;

const speciesClasses = {
  DOG: "border-species-dog/20 bg-species-dog-soft text-species-dog",
  CAT: "border-species-cat/20 bg-species-cat-soft text-species-cat"
} as const;

export function PetSpeciesBadge({ species }: PetSpeciesBadgeProps) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${speciesClasses[species]}`}>
      {speciesLabels[species]}
    </span>
  );
}
