import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { writeServerLog } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { logUnexpectedError } from "@/lib/server-errors";
import { isSuspendedUserForSignIn } from "@/lib/user-access";

const baseAdapter = PrismaAdapter(prisma);

const suspensionAwareAdapter = {
  ...baseAdapter,
  async getSessionAndUser(sessionToken: string) {
    // signIn callbackだけでは停止前に発行済みのDB Sessionを拒否できないため、Session参照時にも最新状態を確認する。
    const result = await baseAdapter.getSessionAndUser?.(sessionToken);
    if (!result) return null;

    const currentUser = await prisma.user.findUnique({
      where: { id: result.user.id },
      select: { accessStatus: true }
    });
    if (!currentUser || currentUser.accessStatus === "SUSPENDED") {
      await prisma.session.deleteMany({ where: { sessionToken } });
      return null;
    }

    return result;
  }
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: suspensionAwareAdapter,
  providers: [Google],
  pages: {
    signIn: "/login"
  },
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60
  },
  trustHost: true,
  logger: {
    error(error) {
      logUnexpectedError(error, { operation: "auth.nextAuth" });
    },
    warn(code) {
      writeServerLog("warn", {
        event: "auth_warning",
        message: `Auth.js warning: ${code}`,
        operation: "auth.nextAuth"
      });
    }
  },
  callbacks: {
    async signIn({ user }) {
      if (await isSuspendedUserForSignIn({ id: user.id, email: user.email })) {
        return "/login?status=accountSuspended";
      }

      return true;
    },
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.appRole = user.appRole;
        session.user.accessStatus = user.accessStatus;
      }

      return session;
    }
  }
});
