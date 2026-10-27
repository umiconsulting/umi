export function visibleStaffForRoster(staff, roleId) {
  return roleId === 'ALL' ? staff : staff.filter((person) => person.roleId === roleId);
}
