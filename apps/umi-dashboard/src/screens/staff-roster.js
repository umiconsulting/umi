export function visibleStaffForRoster(staff, roleId) {
  return roleId === 'ALL' ? staff : staff.filter((person) => person.roleId === roleId);
}

export function staffRowAccess(person, { canAssignAdmin = false, membershipId = null } = {}) {
  const isAdmin = person?.role === 'ADMIN';
  const isSelf = Boolean(membershipId && person?.id === membershipId);
  const locked = isAdmin && !canAssignAdmin;
  const canEditAccess = !locked || (isSelf && person?.roleKey !== 'owner');
  return { isAdmin, isSelf, locked, canEditAccess };
}
