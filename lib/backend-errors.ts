export class BackendError extends Error {
  code:string;
  status:number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code=code;
    this.status=status;
    this.name = 'BackendError';
  }
}

export const conflict = () => new BackendError('VERSION_CONFLICT', 'Another change was saved. Refresh the workspace and try again.', 409);
export const forbidden = () => new BackendError('FORBIDDEN', 'You do not have editing access to this plan.', 403);
export const missingPlan = () => new BackendError('PLAN_NOT_FOUND', 'This plan is unavailable.', 404);
