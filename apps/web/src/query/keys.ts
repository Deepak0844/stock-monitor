// Every cache key, so two pages asking for the same data always share one entry.
// Keys are arrays read left to right: invalidating ["proposals"] also refreshes ["proposals", "settings"].
// RTK Query: the endpoint name + its args make the key for you; tags play the part of the prefix.

export const queryKeys = {
  proposals: {
    all: ["proposals"] as const,
    settings: () => [...queryKeys.proposals.all, "settings"] as const,
  },
};
