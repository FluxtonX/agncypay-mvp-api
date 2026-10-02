import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') ||
        'agncypay-jwt-secret-change-in-production',
    });
  }

  async validate(payload: {
    sub?: string;
    id?: string;
    userId?: string;
    email?: string;
    sv?: number;
  }) {
    const userId = payload.sub || payload.id || payload.userId;
    if (!userId && !payload.email) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        ...(userId ? { id: userId } : { email: payload.email }),
        deletedAt: null,
        emailVerified: true,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        accountType: true,
        agncyId: true,
        emailVerified: true,
        sessionVersion: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (payload.sv !== user.sessionVersion) {
      throw new UnauthorizedException('Session has been revoked');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      accountType: user.accountType,
      agncyId: user.agncyId,
      emailVerified: user.emailVerified,
    };
  }
}
