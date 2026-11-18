import { baseApi } from "./baseApi";

export const socialFeedReportApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    findAllSocialFeedReports: builder.query({
      query: ({ searchTerm = "", page = 1, limit = 10, status = "" }) => ({
        url: `social_feed_report/find_by_all_social_feed_report`,
        method: "GET",
        params: {
          searchTerm,
          page,
          limit,
          sort: "-createdAt",
          ...(status ? { status } : {}),
        },
      }),
      transformResponse: (response) => ({
        data: response.data,
      }),
      providesTags: ["socialFeedReport"],
    }),
    deleteSocialFeedReport: builder.mutation({
      query: (id) => ({
        url: `social_feed_report/delete_social_feed_report/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["socialFeedReport", "dashboard"],
    }),
    // status: "under_review" | "resolved" | "dismissed"
    updateSocialFeedReportStatus: builder.mutation({
      query: ({ id, status, adminNote }) => ({
        url: `social_feed_report/update_status/${id}`,
        method: "PATCH",
        body: { status, ...(adminNote !== undefined ? { adminNote } : {}) },
      }),
      invalidatesTags: ["socialFeedReport", "dashboard"],
    }),
  }),
});

export const {
  useFindAllSocialFeedReportsQuery,
  useDeleteSocialFeedReportMutation,
  useUpdateSocialFeedReportStatusMutation,
} = socialFeedReportApi;
