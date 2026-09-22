export const ROLES = ["USER", "GYM_OWNER", "GYM_STAFF", "TRAINER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "gym:read",
  "gym:update",
  "member:read",
  "member:write",
  "plan:write",
  "attendance:scan",
  "class:write",
  "finance:read",
  "refund:request",
  "campaign:write",
  "staff:manage",
  "trainer:clients",
  "trainer:sessions",
  "trainer:workouts",
  "message:write",
  "admin:platform"
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const OWNER_DEFAULT_PERMISSIONS: Permission[] = [
  "gym:read",
  "gym:update",
  "member:read",
  "member:write",
  "plan:write",
  "attendance:scan",
  "class:write",
  "finance:read",
  "refund:request",
  "campaign:write",
  "staff:manage"
];

export const TRAINER_DEFAULT_PERMISSIONS: Permission[] = [
  "gym:read",
  "member:read",
  "trainer:clients",
  "trainer:sessions",
  "trainer:workouts",
  "message:write"
];
