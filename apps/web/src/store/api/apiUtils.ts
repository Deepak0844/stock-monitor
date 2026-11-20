// Cache keys for each type of data. Keys are arrays read left to right, so invalidating allKey("Proposal") also refreshes
// every list, page and single item of that type.

/** Everything of one type. */
export const allKey = (type: string) => [type] as const;

/** Every list of one type, whatever page or filter. */
export const listKey = (type: string) => [...allKey(type), "list"] as const;

/** One page of a list. */
export const pageKey = <A extends object>(type: string, args: A) => [...listKey(type), args] as const;

/** One item. */
export const entityKey = (type: string, id: string) => [...allKey(type), "detail", id] as const;
