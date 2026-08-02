import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { planMemoryRecordsForHamsterDeletion } from "../src/lib/records";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const sharedMemory = {
  id: "memory-shared",
  representativeHamsterId: "hamster-1",
  hamsterIds: ["hamster-1", "hamster-2", "hamster-3"],
  imageFileNames: ["shared.webp"]
};

test("共有思い出の非代表ハムスター削除では記録と画像を保持する", () => {
  const [plan] = planMemoryRecordsForHamsterDeletion([sharedMemory], ["hamster-2"]);
  assert.deepEqual(plan, {
    recordId: "memory-shared",
    deleteRecord: false,
    nextRepresentativeHamsterId: "hamster-1",
    imageFileNamesToDelete: []
  });
});

test("共有思い出の代表ハムスター削除では残る先頭へ代表を変更する", () => {
  const [plan] = planMemoryRecordsForHamsterDeletion([sharedMemory], ["hamster-1"]);
  assert.deepEqual(plan, {
    recordId: "memory-shared",
    deleteRecord: false,
    nextRepresentativeHamsterId: "hamster-2",
    imageFileNamesToDelete: []
  });
});

test("対象が1匹だけの思い出ではハムスター削除時に記録と画像を削除する", () => {
  const [plan] = planMemoryRecordsForHamsterDeletion([{
    id: "memory-single",
    representativeHamsterId: "hamster-1",
    hamsterIds: ["hamster-1"],
    imageFileNames: ["single.webp"]
  }], ["hamster-1"]);
  assert.deepEqual(plan, {
    recordId: "memory-single",
    deleteRecord: true,
    nextRepresentativeHamsterId: null,
    imageFileNamesToDelete: ["single.webp"]
  });
});

test("一括削除は対象外が残る共有思い出だけを保持する", () => {
  const plans = planMemoryRecordsForHamsterDeletion([
    sharedMemory,
    {
      id: "memory-deleted",
      representativeHamsterId: "hamster-1",
      hamsterIds: ["hamster-1", "hamster-2"],
      imageFileNames: ["deleted.webp", "deleted.webp"]
    }
  ], ["hamster-1", "hamster-2"]);
  assert.deepEqual(plans, [
    {
      recordId: "memory-shared",
      deleteRecord: false,
      nextRepresentativeHamsterId: "hamster-3",
      imageFileNamesToDelete: []
    },
    {
      recordId: "memory-deleted",
      deleteRecord: true,
      nextRepresentativeHamsterId: null,
      imageFileNamesToDelete: ["deleted.webp"]
    }
  ]);
});

test("単体・一括Actionは判定・代表付け替え・ハムスター削除を同じtransactionへ入れる", () => {
  const actions = source("src/app/actions/hamsters.ts");
  const helperStart = actions.indexOf("async function prepareMemoryRecordsForHamsterDeletion");
  const singleStart = actions.indexOf("export async function deleteHamster");
  const bulkStart = actions.indexOf("export async function deleteHamsters");
  const helper = actions.slice(helperStart, singleStart);
  const single = actions.slice(singleStart, bulkStart);
  const bulk = actions.slice(bulkStart);

  assert.match(helper, /tx\.hamsterRecord\.findMany/);
  assert.match(helper, /tx\.hamsterRecord\.update/);
  assert.match(helper, /tx\.hamsterRecord\.deleteMany/);
  assert.match(single, /mutate: async \(tx\) => \{[\s\S]*prepareMemoryRecordsForHamsterDeletion[\s\S]*tx\.hamster\.deleteMany/);
  assert.match(bulk, /mutate: async \(tx\) => \{[\s\S]*prepareMemoryRecordsForHamsterDeletion[\s\S]*tx\.hamster\.deleteMany/);
  assert.match(actions, /const deletedFileNames = new Set<string>\(\)/);
  assert.equal((actions.match(/deletedMemoryRecords,/g) ?? []).length, 2);
});
