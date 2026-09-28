// Gym-entered contact data remains visible. Account data is disclosed only
// after the account holder accepts this new gym relationship.
export function privatePendingMember(member: any) {
  if (member.invitation?.status !== "PENDING") return member;
  return { ...member, userId: undefined };
}
