import { mockDb, mockOk } from "@/lib/mocks/data";

const pause = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

export const mockApi = {
  health: async () => { await pause(); return mockOk(mockDb.health); },
  cjAuthorize: async (input: unknown) => { await pause(); return mockOk({ ...input, authorized: true }); },
  cjAdvertisers: async () => { await pause(); return mockOk(mockDb.cj.advertisers); },
  cjProducts: async (input: unknown) => { await pause(); return mockOk({ query: input, items: mockDb.cj.products }); },
  impactAuthorize: async (input: unknown) => { await pause(); return mockOk({ ...input, authorized: true }); },
  impactCampaigns: async () => { await pause(); return mockOk(mockDb.impact.campaigns); },
  impactCampaignById: async (id: string) => { await pause(); return mockOk({ id, name: "Campaign " + id }); },
  impactDeals: async () => { await pause(); return mockOk(mockDb.impact.deals); },
  impactDealById: async (id: string) => { await pause(); return mockOk({ id, title: "Deal " + id }); },
  impactCatalogs: async () => { await pause(); return mockOk([{ id: "cat-1", name: "Main Catalog" }]); },
  impactCatalogItems: async () => { await pause(); return mockOk([{ id: "item-1", name: "Catalog Item" }]); },
  impactItemSearch: async (q: string) => { await pause(); return mockOk([{ id: "s-1", keyword: q }]); },
  impactMediaProperties: async () => { await pause(); return mockOk([{ id: "m-1", type: "image" }]); },
  impactTrackingLink: async (input: unknown) => { await pause(); return mockOk({ shortUrl: "https://trk.local/abc", request: input }); },
  wpAuthorize: async (input: unknown) => { await pause(); return mockOk({ ...input, authorized: true }); },
  wpUploadMedia: async (filename: string) => { await pause(); return mockOk({ id: "media-1", filename }); },
  wpCreateProduct: async (input: unknown) => { await pause(); return mockOk({ id: "wp-prod-1", ...input }); },
  metricoolAuthorize: async (token: string) => { await pause(); return mockOk({ token, authorized: true }); },
  metricoolProfiles: async () => { await pause(); return mockOk(mockDb.metricool.profiles); },
  metricoolUploadMedia: async (input: unknown) => { await pause(); return mockOk({ id: "met-media-1", ...input }); },
  metricoolCreatePost: async (input: unknown) => { await pause(); return mockOk({ id: "sched-1", ...input }); },
  metricoolGetPosts: async () => { await pause(); return mockOk([{ id: "sched-1", status: "scheduled" }]); },
  renderformAuthorize: async (apiKey: string) => { await pause(); return mockOk({ apiKey: apiKey.slice(0, 4) + "***", authorized: true }); },
  renderformTemplates: async () => { await pause(); return mockOk(mockDb.renderform.templates); },
  renderformRenderUrl: async (imageUrl: string) => { await pause(); return mockOk({ rendered: imageUrl + "?rendered=true" }); },
  renderformRenderUpload: async (filename: string) => { await pause(); return mockOk({ uploaded: true, filename, renderUrl: "https://img.local/rendered.png" }); }
};
