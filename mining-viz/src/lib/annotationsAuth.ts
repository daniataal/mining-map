import axios from 'axios';

export function isAnnotationsAuthError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 401;
}
