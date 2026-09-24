export interface HelperPermissionSubjectIdentity {
  appPath: string;
  executablePath: string;
  displayName: string;
  bundleId: string;
  [key: string]: unknown;
}

export declare function resolveHelperPermissionSubjectIdentity(
  appPath: string,
): Promise<HelperPermissionSubjectIdentity>;
