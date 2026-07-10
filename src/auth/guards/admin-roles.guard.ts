import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "../../../generated/prisma/enums";
import { AuthenticatedUser } from "../authenticated-request";
import { ADMIN_ROLES_KEY } from "../decorators/admin-roles.decorator";

type RequestWithAuth = {
  user?: AuthenticatedUser;
};

const DEFAULT_ADMIN_ROLES = [
  UserRole.ADMIN,
  UserRole.ADMIN_ACCOUNTING,
  UserRole.CHIN_CHIN_SUPPORT,
];

@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const allowedRoles =
      this.reflector.getAllAndOverride<UserRole[]>(ADMIN_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_ADMIN_ROLES;

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const role = request.user?.role as UserRole | undefined;

    if (!role || !allowedRoles.includes(role)) {
      throw new ForbiddenException("Admin permission is required.");
    }

    return true;
  }
}
