import { SetMetadata } from "@nestjs/common";
import { UserRole } from "../../../generated/prisma/enums";

export const ADMIN_ROLES_KEY = "admin_roles";

export const AdminRoles = (...roles: UserRole[]) =>
  SetMetadata(ADMIN_ROLES_KEY, roles);
