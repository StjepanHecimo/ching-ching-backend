export type AuthenticatedUser = {
  userId: string;
  email: string;
  role: string;
};

export type AuthenticatedRequest = {
  user: AuthenticatedUser;
};
