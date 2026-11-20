// Cache keys for each type of data. Keys are arrays read left to right, so invalidating allKey("Proposal") also refreshes
// every list, page and single item of that type.
// RTK Query: apiUtils listTags / paginatedTags / entityTags, given to providesTags and invalidatesTags.

/** Everything of one type. RTK Query: invalidating every tag of `type`. */
export const allKey = (type: string) => [type] as const;

/** Every list of one type, whatever page or filter. RTK Query: listTags(type), { type, id: "LIST" }. */
export const listKey = (type: string) => [...allKey(type), "list"] as const;

/** One page of a list. RTK Query: paginatedTags(type), { type, id: "PAGE-..." }. */
export const pageKey = <A extends object>(type: string, args: A) => [...listKey(type), args] as const;

/** One item. RTK Query: entityTags(type, idKey), { type, id }. */
export const entityKey = (type: string, id: string) => [...allKey(type), "detail", id] as const;
