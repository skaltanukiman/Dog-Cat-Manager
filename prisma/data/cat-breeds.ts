import { buildBreedSeeds } from "./breed-data";

// Sources: TICA Browse All Breeds / CFA Recognized Breeds. Coat-length and tailed variants are canonicalized.
// https://tica.org/ticas-breeds/browse-all-breeds/ / https://cfa.org/breeds/
const entries = [
  ["アビシニアン", "Abyssinian"], ["アメリカン・ボブテイル", "American Bobtail"],
  ["アメリカン・カール", "American Curl"], ["アメリカン・ショートヘア", "American Shorthair"],
  ["アメリカン・ワイヤーヘア", "American Wirehair"], ["オーストラリアン・ミスト", "Australian Mist"],
  ["バリニーズ", "Balinese"], ["ベンガル", "Bengal"], ["バーマン", "Birman"], ["ボンベイ", "Bombay"],
  ["ブリティッシュ・ロングヘア", "British Longhair"], ["ブリティッシュ・ショートヘア", "British Shorthair"],
  ["バーミーズ", "Burmese"], ["バーミラ", "Burmilla"], ["シャルトリュー", "Chartreux"],
  ["チャウシー", "Chausie"], ["コーニッシュ・レックス", "Cornish Rex"], ["キムリック", "Cymric"],
  ["デボン・レックス", "Devon Rex"], ["ドンスコイ", "Donskoy"], ["エジプシャン・マウ", "Egyptian Mau"],
  ["エキゾチック・ショートヘア", "Exotic Shorthair"], ["ヨーロピアン・ショートヘア", "European Shorthair"],
  ["ジャーマン・レックス", "German Rex"], ["ハバナ・ブラウン", "Havana Brown"], ["ハイランダー", "Highlander"],
  ["ヒマラヤン", "Himalayan"], ["ジャパニーズ・ボブテイル", "Japanese Bobtail"],
  ["カオマニー", "Khao Manee"], ["コラット", "Korat"], ["クリリアン・ボブテイル", "Kurilian Bobtail"],
  ["ラパーマ", "LaPerm"], ["ライコイ", "Lykoi"], ["メイン・クーン", "Maine Coon"], ["マンクス", "Manx"],
  ["ミヌエット", "Minuet"], ["マンチカン", "Munchkin"], ["ネベロング", "Nebelung"],
  ["ノルウェージャン・フォレスト・キャット", "Norwegian Forest Cat"], ["オシキャット", "Ocicat"],
  ["オリエンタル・ロングヘア", "Oriental Longhair"], ["オリエンタル・ショートヘア", "Oriental Shorthair"],
  ["ペルシャ", "Persian"], ["ピーターボールド", "Peterbald"], ["ピクシーボブ", "Pixiebob"],
  ["ラグドール", "Ragdoll"], ["ロシアン・ブルー", "Russian Blue"], ["サバンナ", "Savannah"],
  ["スコティッシュ・フォールド", "Scottish Fold"], ["スコティッシュ・ストレート", "Scottish Straight"],
  ["セルカーク・レックス", "Selkirk Rex"], ["シャム", "Siamese"], ["サイベリアン", "Siberian"],
  ["シンガプーラ", "Singapura"], ["スノーシュー", "Snowshoe"], ["ソコケ", "Sokoke"],
  ["ソマリ", "Somali"], ["スフィンクス", "Sphynx"], ["テネシー・レックス", "Tennessee Rex"],
  ["タイ", "Thai"], ["トンキニーズ", "Tonkinese"], ["トイガー", "Toyger"],
  ["ターキッシュ・アンゴラ", "Turkish Angora"], ["ターキッシュ・バン", "Turkish Van"]
] as const;

const popular = [
  "スコティッシュ・フォールド", "マンチカン", "アメリカン・ショートヘア", "ブリティッシュ・ショートヘア",
  "ノルウェージャン・フォレスト・キャット", "ラグドール", "メイン・クーン", "ロシアン・ブルー",
  "サイベリアン", "ベンガル", "ミヌエット", "ペルシャ", "エキゾチック・ショートヘア",
  "シャム", "アビシニアン"
] as const;

const names = entries.map(([nameJa]) => nameJa);
const english = Object.fromEntries(entries);

export const catBreeds = buildBreedSeeds("CAT", names, { popular, english });
