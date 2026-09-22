export type OwnerScope = {
  ownerId: string;
  includeUnowned?: boolean;
};

export function ownerIdFor(code: string): string;

export function normalizePlayerId(raw: string | null | undefined): string | null;

export function scopeForAccess(input: {
  code: string | null | undefined;
  role?: string | null;
  playerId?: string | null;
}): OwnerScope;

export function canSeeSandbox(row: { ownerId?: string } | null | undefined, scope: OwnerScope): boolean;

export function visibleToOwner<T extends { ownerId?: string }>(rows: T[], scope: OwnerScope): T[];

export function findOwned<T extends { id: string; ownerId?: string }>(
  rows: T[],
  id: string,
  scope: OwnerScope,
): T | undefined;

export function omitOwner<T extends { ownerId?: string }>(row: T): Omit<T, "ownerId">;
