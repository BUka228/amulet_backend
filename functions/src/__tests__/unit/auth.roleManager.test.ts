/**
 * Unit тесты для RoleManager
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as admin from 'firebase-admin';
import { RoleManager } from '../../core/auth';

// Мокаем Firebase Admin SDK
jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    getUser: jest.fn(),
    setCustomUserClaims: jest.fn(),
  })),
}));

// Мокаем Firestore
jest.mock('../../core/firebase', () => ({
  db: {
    collection: jest.fn(),
  },
}));

import { db } from '../../core/firebase';

const mockAuth = admin.auth as jest.MockedFunction<typeof admin.auth>;

describe('RoleManager', () => {
  const mockGetUser = jest.fn();
  const mockSetCustomUserClaims = jest.fn();

  beforeEach(() => {
    mockAuth.mockReturnValue({
      getUser: mockGetUser,
      setCustomUserClaims: mockSetCustomUserClaims,
    } as any);
    
    // Сбрасываем моки
    mockGetUser.mockClear();
    mockSetCustomUserClaims.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('assignRole', () => {
    test('should assign admin role to user and update Firestore', async () => {
      const uid = 'test-user';
      const role = 'admin';
      const value = true;
      
      const mockUser = {
        uid,
        customClaims: { existing: 'claim' }
      };
      
      mockGetUser.mockResolvedValue(mockUser as any);
      mockSetCustomUserClaims.mockResolvedValue(undefined);

      // Мокаем Firestore обновление
      const mockSet = jest.fn().mockResolvedValue(undefined);
      (db.collection as jest.Mock).mockReturnValue({
        doc: jest.fn().mockReturnValue({
          set: mockSet
        })
      });

      await RoleManager.assignRole(uid, role, value);

      expect(mockGetUser).toHaveBeenCalledWith(uid);
      expect(mockSetCustomUserClaims).toHaveBeenCalledWith(uid, {
        existing: 'claim',
        admin: true
      });
      expect(db.collection).toHaveBeenCalledWith('users');
      expect(mockSet).toHaveBeenCalledWith({
        roles: {
          [role]: value
        }
      }, { merge: true });
    });

    test('should assign moderator role to user', async () => {
      const uid = 'test-user';
      const role = 'moderator';
      const value = true;
      
      const mockUser = {
        uid,
        customClaims: {}
      };
      
      mockGetUser.mockResolvedValue(mockUser as any);
      mockSetCustomUserClaims.mockResolvedValue(undefined);

      await RoleManager.assignRole(uid, role, value);

      expect(mockSetCustomUserClaims).toHaveBeenCalledWith(uid, {
        moderator: true
      });
    });

    test('should handle user with no existing claims', async () => {
      const uid = 'test-user';
      const role = 'admin';
      const value = true;
      
      const mockUser = {
        uid,
        customClaims: null
      };
      
      mockGetUser.mockResolvedValue(mockUser as any);
      mockSetCustomUserClaims.mockResolvedValue(undefined);

      await RoleManager.assignRole(uid, role, value);

      expect(mockSetCustomUserClaims).toHaveBeenCalledWith(uid, {
        admin: true
      });
    });

    test('should handle errors during role assignment', async () => {
      const uid = 'test-user';
      const role = 'admin';
      const value = true;
      
      mockGetUser.mockRejectedValue(new Error('User not found'));

      await expect(RoleManager.assignRole(uid, role, value))
        .rejects.toThrow('User not found');
    });
  });

  describe('revokeRole', () => {
    test('should revoke admin role from user and update Firestore', async () => {
      const uid = 'test-user';
      const role = 'admin';
      
      const mockUser = {
        uid,
        customClaims: { 
          admin: true, 
          moderator: true,
          other: 'claim'
        }
      };
      
      mockGetUser.mockResolvedValue(mockUser as any);
      mockSetCustomUserClaims.mockResolvedValue(undefined);

      // Мокаем Firestore обновление
      const mockSet = jest.fn().mockResolvedValue(undefined);
      (db.collection as jest.Mock).mockReturnValue({
        doc: jest.fn().mockReturnValue({
          set: mockSet
        })
      });

      await RoleManager.revokeRole(uid, role);

      expect(mockGetUser).toHaveBeenCalledWith(uid);
      expect(mockSetCustomUserClaims).toHaveBeenCalledWith(uid, {
        moderator: true,
        other: 'claim'
      });
      expect(db.collection).toHaveBeenCalledWith('users');
      expect(mockSet).toHaveBeenCalledWith({
        roles: {
          [role]: false
        }
      }, { merge: true });
    });

    test('should revoke moderator role from user', async () => {
      const uid = 'test-user';
      const role = 'moderator';
      
      const mockUser = {
        uid,
        customClaims: { 
          admin: true, 
          moderator: true
        }
      };
      
      mockGetUser.mockResolvedValue(mockUser as any);
      mockSetCustomUserClaims.mockResolvedValue(undefined);

      await RoleManager.revokeRole(uid, role);

      expect(mockSetCustomUserClaims).toHaveBeenCalledWith(uid, {
        admin: true
      });
    });

    test('should handle user with no existing claims', async () => {
      const uid = 'test-user';
      const role = 'admin';
      
      const mockUser = {
        uid,
        customClaims: null
      };
      
      mockGetUser.mockResolvedValue(mockUser as any);
      mockSetCustomUserClaims.mockResolvedValue(undefined);

      await RoleManager.revokeRole(uid, role);

      expect(mockSetCustomUserClaims).toHaveBeenCalledWith(uid, {});
    });

    test('should handle errors during role revocation', async () => {
      const uid = 'test-user';
      const role = 'admin';
      
      mockGetUser.mockRejectedValue(new Error('User not found'));

      await expect(RoleManager.revokeRole(uid, role))
        .rejects.toThrow('User not found');
    });
  });

  describe('getUserRoles', () => {
    test('should return user roles correctly', async () => {
      const uid = 'test-user';
      
      const mockUser = {
        uid,
        customClaims: { 
          admin: true, 
          moderator: false,
          other: 'claim'
        }
      };
      
      mockGetUser.mockResolvedValue(mockUser as any);

      const roles = await RoleManager.getUserRoles(uid);

      expect(roles).toEqual({
        admin: true,
        moderator: false
      });
    });

    test('should return false for missing roles', async () => {
      const uid = 'test-user';
      
      const mockUser = {
        uid,
        customClaims: { 
          other: 'claim'
        }
      };
      
      mockGetUser.mockResolvedValue(mockUser as any);

      const roles = await RoleManager.getUserRoles(uid);

      expect(roles).toEqual({
        admin: false,
        moderator: false
      });
    });

    test('should handle user with no claims', async () => {
      const uid = 'test-user';
      
      const mockUser = {
        uid,
        customClaims: null
      };
      
      mockGetUser.mockResolvedValue(mockUser as any);

      const roles = await RoleManager.getUserRoles(uid);

      expect(roles).toEqual({
        admin: false,
        moderator: false
      });
    });

    test('should handle errors during role retrieval', async () => {
      const uid = 'test-user';
      
      mockGetUser.mockRejectedValue(new Error('User not found'));

      await expect(RoleManager.getUserRoles(uid))
        .rejects.toThrow('User not found');
    });
  });

  describe('hasRole', () => {
    test('should return true for existing role', async () => {
      const uid = 'test-user';
      const role = 'admin';
      
      const mockUser = {
        uid,
        customClaims: { 
          admin: true, 
          moderator: false
        }
      };
      
      mockGetUser.mockResolvedValue(mockUser as any);

      const hasRole = await RoleManager.hasRole(uid, role);

      expect(hasRole).toBe(true);
    });

    test('should return false for missing role', async () => {
      const uid = 'test-user';
      const role = 'moderator';
      
      const mockUser = {
        uid,
        customClaims: { 
          admin: true
        }
      };
      
      mockGetUser.mockResolvedValue(mockUser as any);

      const hasRole = await RoleManager.hasRole(uid, role);

      expect(hasRole).toBe(false);
    });

    test('should handle errors during role check', async () => {
      const uid = 'test-user';
      const role = 'admin';
      
      mockGetUser.mockRejectedValue(new Error('User not found'));

      await expect(RoleManager.hasRole(uid, role))
        .rejects.toThrow('User not found');
    });
  });

  describe('getUsersWithRole', () => {
    test('should get users with role from Firestore', async () => {
      const role = 'admin';
      
      // Мокаем Firestore запрос
      const mockSnapshot = {
        docs: [
          { id: 'user1' },
          { id: 'user2' },
          { id: 'user3' }
        ]
      };
      
      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(mockSnapshot)
        })
      });

      const result = await RoleManager.getUsersWithRole(role);
      expect(result).toEqual(['user1', 'user2', 'user3']);
      expect(db.collection).toHaveBeenCalledWith('users');
    });

    test('should handle error when getting users with role', async () => {
      const role = 'admin';
      
      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnValue({
          get: jest.fn().mockRejectedValue(new Error('Firestore error'))
        })
      });

      const result = await RoleManager.getUsersWithRole(role);
      expect(result).toEqual([]);
    });
  });
});
