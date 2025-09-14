/**
 * Типы для аутентификации и авторизации
 */

export interface AuthUser {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  emailVerified: boolean;
  disabled: boolean;
  metadata: {
    creationTime: string;
    lastSignInTime?: string;
  };
  customClaims?: Record<string, string | number | boolean>;
}

export interface AuthContext {
  user: AuthUser;
  token: string;
  isAuthenticated: boolean;
}

export interface AuthError {
  code: 'unauthenticated' | 'permission_denied' | 'invalid_token' | 'token_expired';
  message: string;
  details?: Record<string, string | number | boolean>;
}

export interface AppCheckContext {
  appId: string;
  token: string;
  isVerified: boolean;
}

export interface AuthMiddlewareOptions {
  requireAppCheck?: boolean;
  requireEmailVerified?: boolean;
  requireCustomClaim?: string;
  allowAnonymous?: boolean;
}

export interface DecodedIdToken {
  iss: string;
  aud: string;
  auth_time: number;
  user_id: string;
  sub: string;
  iat: number;
  exp: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  firebase: {
    identities: Record<string, string[]>;
    sign_in_provider: string;
  };
  [key: string]: string | number | boolean | object | undefined;
}
