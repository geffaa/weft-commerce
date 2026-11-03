import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "../db/schema";
import { AuthService, type Session } from "./auth.service";

export const ROLES_KEY = "roles";
/** Peran yang boleh. Owner selalu boleh. Tanpa dekorator = hanya perlu login. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export type AuthedRequest = { headers: Record<string, string | undefined>; session?: Session };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(Reflector) private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const h = req.headers.authorization ?? "";
    if (!h.startsWith("Bearer ")) throw new UnauthorizedException();
    req.session = await this.auth.verifyToken(h.slice(7));
    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (allowed && req.session.role !== "owner" && !allowed.includes(req.session.role)) throw new ForbiddenException("Your role cannot do this");
    return true;
  }
}
