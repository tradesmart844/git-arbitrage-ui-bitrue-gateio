export class BaseResponse<T> implements BaseResponse<T> {
  constructor(public error: boolean, public message: string, public data: T) {}
}
