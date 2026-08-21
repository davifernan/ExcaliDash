#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Hand control of every board inside a collection to that collection's owner.
 *
 * A board drawn inside someone else's collection used to belong to the person
 * who drew it, while the collection's owner already had owner *access* to it.
 * The two disagreed, and routes picked whichever they happened to check. New
 * boards follow the collection from now on; this brings the existing ones along.
 *
 * Reports by default and changes nothing. Pass --apply to write, after taking a
 * copy of the database: the previous owner is not recorded anywhere afterwards.
 */
const path = require("path");
const { PrismaClient } = require(path.resolve(__dirname, "../src/generated/client"));

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

const isTrashCollection = (collectionId) =>
  typeof collectionId === "string" &&
  (collectionId === "trash" || collectionId.startsWith("trash:"));


/**
 * Which assets may follow their boards to a new owner.
 *
 * Kept free of Prisma so the decision can be tested without a database: a
 * backfill that quietly does the wrong thing is worse than one that refuses,
 * and the only way to know which it does is to be able to run it.
 *
 * - `rewrite`  every board using it is part of this run, and they all land on
 *              the same owner.
 * - `shared`   some other board still uses it. Left alone.
 * - `ambiguous` the moving boards land on different owners. No correct answer.
 */
const planAssetOwnership = ({ links, outsideLinks, futureOwnerOf }) => {
  const movingIds = new Set(links.map((link) => link.drawingId));
  const ownersPerAsset = new Map();
  for (const link of links) {
    const owners = ownersPerAsset.get(link.assetId) || new Set();
    owners.add(futureOwnerOf.get(link.drawingId));
    ownersPerAsset.set(link.assetId, owners);
  }

  const usedElsewhere = new Set(
    outsideLinks.filter((link) => !movingIds.has(link.drawingId)).map((link) => link.assetId),
  );

  const rewrite = new Set();
  const shared = [];
  const ambiguous = [];
  for (const [assetId, owners] of ownersPerAsset) {
    if (owners.size > 1) ambiguous.push(assetId);
    else if (usedElsewhere.has(assetId)) shared.push(assetId);
    else rewrite.add(assetId);
  }
  return { rewrite, shared, ambiguous };
};

const main = async () => {
  const drawings = await prisma.drawing.findMany({
    where: { collectionId: { not: null } },
    select: {
      id: true,
      name: true,
      userId: true,
      createdByUserId: true,
      collectionId: true,
      collection: { select: { id: true, name: true, userId: true } },
    },
  });

  const moving = drawings.filter(
    (drawing) =>
      drawing.collection &&
      !isTrashCollection(drawing.collectionId) &&
      drawing.collection.userId !== drawing.userId,
  );

  if (moving.length === 0) {
    console.log("Nothing to do: every board already belongs to the collection it sits in.");
    return;
  }

  const userIds = Array.from(
    new Set(moving.flatMap((drawing) => [drawing.userId, drawing.collection.userId])),
  );
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const nameOf = new Map(users.map((user) => [user.id, `${user.name} <${user.email}>`]));

  // Who keeps a way in afterwards, and who does not.
  const shares = await prisma.collectionShare.findMany({
    where: { collectionId: { in: moving.map((drawing) => drawing.collection.id) } },
    select: { collectionId: true, granteeUserId: true, role: true },
  });
  const shareKey = new Set(shares.map((share) => `${share.collectionId}:${share.granteeUserId}`));
  const permissions = await prisma.drawingPermission.findMany({
    where: { drawingId: { in: moving.map((drawing) => drawing.id) } },
    select: { drawingId: true, granteeUserId: true },
  });
  const permissionKey = new Set(
    permissions.map((permission) => `${permission.drawingId}:${permission.granteeUserId}`),
  );

  console.log(`${moving.length} board(s) change owner:\n`);
  const losing = [];
  for (const drawing of moving) {
    const keepsAccess =
      shareKey.has(`${drawing.collection.id}:${drawing.userId}`) ||
      permissionKey.has(`${drawing.id}:${drawing.userId}`);
    if (!keepsAccess) losing.push(drawing);
    console.log(
      `  "${drawing.name}" in collection "${drawing.collection.name}"\n` +
        `      owner ${nameOf.get(drawing.userId) || drawing.userId}\n` +
        `        ->  ${nameOf.get(drawing.collection.userId) || drawing.collection.userId}\n` +
        `      previous owner keeps access: ${keepsAccess ? "yes" : "NO"}`,
    );
  }

  if (losing.length > 0) {
    console.log(
      `\n${losing.length} board(s) leave their previous owner without access: they drew them in a\n` +
        `collection they are no longer shared on. That is the intended team semantics, but it is\n` +
        `a loss of access, so it is named here rather than discovered later.`,
    );
  }

  // Assets are charged to the board owner. One asset shared by boards heading to
  // different owners has no correct answer, so stop rather than guess.
  const links = await prisma.drawingAsset.findMany({
    where: { drawingId: { in: moving.map((drawing) => drawing.id) } },
    select: { drawingId: true, assetId: true },
  });
  // Every board that points at those assets, not only the ones being moved. An
  // asset is owned once, so rewriting its owner reaches every board that uses
  // it — including boards this run was never asked to touch. Their owner would
  // lose the document without appearing anywhere in the report.
  const outsideLinks = await prisma.drawingAsset.findMany({
    where: { assetId: { in: Array.from(new Set(links.map((link) => link.assetId))) } },
    select: { drawingId: true, assetId: true },
  });
  const futureOwnerOf = new Map(moving.map((drawing) => [drawing.id, drawing.collection.userId]));
  const plan = planAssetOwnership({ links, outsideLinks, futureOwnerOf });

  if (plan.ambiguous.length > 0) {
    console.error(
      `\nRefusing to continue: ${plan.ambiguous.length} asset(s) are used by boards moving to different owners.`,
    );
    process.exitCode = 1;
    return;
  }
  if (plan.shared.length > 0) {
    console.log(
      `\n${plan.shared.length} document(s) stay with their current owner: a board outside this run\n` +
        `still uses them. The boards move; the documents are left alone rather than taken from\n` +
        `someone who was not part of this.`,
    );
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these changes.");
    return;
  }

  for (const drawing of moving) {
    await prisma.$transaction(async (tx) => {
      await tx.drawing.update({
        where: { id: drawing.id },
        data: {
          userId: drawing.collection.userId,
          createdByUserId: drawing.createdByUserId ?? drawing.userId,
        },
      });
      // A row granting the new owner access to their own board is noise at best
      // and a contradiction at worst.
      await tx.drawingPermission.deleteMany({
        where: { drawingId: drawing.id, granteeUserId: drawing.collection.userId },
      });
      const assetIds = links
        .filter((link) => link.drawingId === drawing.id && plan.rewrite.has(link.assetId))
        .map((link) => link.assetId);
      if (assetIds.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: assetIds } },
          data: { ownerUserId: drawing.collection.userId },
        });
      }
    });
  }
  console.log(`\nApplied to ${moving.length} board(s).`);
};

module.exports = { planAssetOwnership };

if (require.main === module) {
  run();
}

function run() {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
