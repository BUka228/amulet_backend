/**
 * Middleware для аутентификации и авторизации
 */

import * as admin from 'firebase-admin';
import { Request, Response, NextFunction } from 'express';
import { AuthContext, AuthError, AppCheckContext, AuthMiddlewareOptions } from '../types/auth';
import * as logger from 'firebase-functions/logger';

// Расширяем типы Express для добавления auth контекста
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      appCheck?: AppCheckContext;
    }
  }
}

/**
 * Middleware для проверки Firebase ID Token
 */
export const authenticateToken = (options: AuthMiddlewareOptions = {}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        if (options.allowAnonymous) {
          return next();
        }
        return sendAuthError(res, {
          code: 'unauthenticated',
          message: 'Missing or invalid authorization header'
        });
      }

      const idToken = authHeader.split('Bearer ')[1];
      
      if (!idToken) {
        return sendAuthError(res, {
          code: 'unauthenticated',
          message: 'Missing ID token'
        });
      }

      // Верификация ID Token
      const decodedToken = await admin.auth().verifyIdToken(idToken, true);
      
      // Проверка дополнительных требований на основе decodedToken (быстрее)
      if (options.requireEmailVerified && !decodedToken.email_verified) {
        return sendAuthError(res, {
          code: 'permission_denied',
          message: 'Email verification required'
        });
      }

      // Для custom claims нужно получить актуальную информацию
      let userRecord = null;
      if (options.requireCustomClaim) {
        userRecord = await admin.auth().getUser(decodedToken.uid);
        if (!userRecord.customClaims?.[options.requireCustomClaim]) {
          return sendAuthError(res, {
            code: 'permission_denied',
            message: `Custom claim '${options.requireCustomClaim}' required`
          });
        }
      }

      // Создание контекста аутентификации
      // Если userRecord уже получен, используем его, иначе создаем из decodedToken
      const authContext: AuthContext = userRecord ? {
        user: {
          uid: userRecord.uid,
          email: userRecord.email,
          displayName: userRecord.displayName,
          photoURL: userRecord.photoURL,
          emailVerified: userRecord.emailVerified,
          disabled: userRecord.disabled,
          metadata: {
            creationTime: userRecord.metadata.creationTime,
            lastSignInTime: userRecord.metadata.lastSignInTime
          },
          customClaims: userRecord.customClaims
        },
        token: idToken,
        isAuthenticated: true
      } : {
        user: {
          uid: decodedToken.uid,
          email: decodedToken.email,
          displayName: decodedToken.name,
          photoURL: decodedToken.picture,
          emailVerified: decodedToken.email_verified || false,
          disabled: false, // decodedToken не содержит информацию о disabled
          metadata: {
            creationTime: new Date(decodedToken.iat * 1000).toISOString(),
            lastSignInTime: decodedToken.auth_time ? new Date(decodedToken.auth_time * 1000).toISOString() : undefined
          },
          customClaims: {} // decodedToken не содержит актуальные custom claims
        },
        token: idToken,
        isAuthenticated: true
      };

      req.auth = authContext;
      
      logger.info('User authenticated', {
        uid: authContext.user.uid,
        email: authContext.user.email,
        requestId: req.headers['x-request-id']
      });

      next();
    } catch (error) {
      logger.error('Authentication failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: req.headers['x-request-id']
      });

      if (error instanceof Error) {
        if (error.message.includes('expired')) {
          return sendAuthError(res, {
            code: 'token_expired',
            message: 'ID token has expired'
          });
        }
        if (error.message.includes('invalid')) {
          return sendAuthError(res, {
            code: 'invalid_token',
            message: 'Invalid ID token'
          });
        }
      }

      return sendAuthError(res, {
        code: 'unauthenticated',
        message: 'Authentication failed'
      });
    }
  };
};

/**
 * Middleware для проверки App Check токена
 */
export const verifyAppCheck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const appCheckToken = req.headers['x-firebase-app-check'] as string;
    
    if (!appCheckToken) {
      return sendAuthError(res, {
        code: 'unauthenticated',
        message: 'App Check token required'
      });
    }

    // Реальная проверка App Check токена через Firebase Admin SDK
    const appCheckClaims = await admin.appCheck().verifyToken(appCheckToken);
    
    const appCheckContext: AppCheckContext = {
      appId: appCheckClaims.appId,
      token: appCheckToken,
      isVerified: true
    };

    req.appCheck = appCheckContext;
    
    logger.info('App Check verified', {
      appId: appCheckClaims.appId,
      requestId: req.headers['x-request-id']
    });

    next();
  } catch (error) {
    logger.error('App Check verification failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id']
    });

    return sendAuthError(res, {
      code: 'unauthenticated',
      message: 'App Check verification failed'
    });
  }
};

/**
 * Middleware для проверки ролей (custom claims)
 */
export const requireRole = (role: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth?.user.customClaims?.[role]) {
      return sendAuthError(res, {
        code: 'permission_denied',
        message: `Role '${role}' required`
      });
    }
    next();
  };
};

/**
 * Middleware для проверки владения ресурсом
 */
export const requireOwnership = (resourceOwnerField: string = 'ownerId') => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return sendAuthError(res, {
        code: 'unauthenticated',
        message: 'Authentication required'
      });
    }

    const resourceOwnerId = req.params?.[resourceOwnerField] || req.body?.[resourceOwnerField];
    
    if (resourceOwnerId !== req.auth.user.uid) {
      return sendAuthError(res, {
        code: 'permission_denied',
        message: 'Access denied: insufficient permissions'
      });
    }

    next();
  };
};

/**
 * Утилита для отправки ошибок аутентификации
 */
function sendAuthError(res: Response, error: AuthError): void {
  res.status(getHttpStatusFromAuthError(error.code)).json({
    code: error.code,
    message: error.message,
    details: error.details
  });
}

/**
 * Преобразование кода ошибки аутентификации в HTTP статус
 */
function getHttpStatusFromAuthError(code: string): number {
  switch (code) {
    case 'unauthenticated':
    case 'invalid_token':
    case 'token_expired':
      return 401;
    case 'permission_denied':
      return 403;
    default:
      return 401;
  }
}

/**
 * Утилита для получения пользователя из контекста
 */
export function getCurrentUser(req: Request): AuthContext['user'] | null {
  return req.auth?.user || null;
}

/**
 * Утилита для проверки роли пользователя
 */
export function hasRole(req: Request, role: string): boolean {
  return req.auth?.user.customClaims?.[role] === true;
}

/**
 * Утилита для проверки владения ресурсом
 */
export function isOwner(req: Request, resourceOwnerId: string): boolean {
  return req.auth?.user.uid === resourceOwnerId;
}
