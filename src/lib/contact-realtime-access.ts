import type { AppRole, UserAccessStatus } from "@prisma/client";

import { isPublicContactId } from "@/lib/contact-inquiry-core";

export type ContactRealtimeViewer = {
  id: string;
  appRole: AppRole;
  accessStatus: UserAccessStatus;
};

export function canViewContactInquiryRealtime(
  viewer: ContactRealtimeViewer,
  inquiry: { userId: string | null }
) {
  if (viewer.accessStatus !== "ACTIVE") return false;
  if (viewer.appRole === "ADMIN" || viewer.appRole === "SUPER_ADMIN") return true;
  return inquiry.userId === viewer.id;
}

export function getContactRealtimeLookup(
  publicId: string | null,
  viewer: ContactRealtimeViewer
) {
  if (!publicId || !isPublicContactId(publicId) || viewer.accessStatus !== "ACTIVE") {
    return null;
  }

  return {
    publicId,
    ...(viewer.appRole === "ADMIN" || viewer.appRole === "SUPER_ADMIN"
      ? {}
      : { userId: viewer.id })
  };
}
