import { baseApi } from "./baseApi";

// Messages users send from the app's Contact / Feedback form (API: /support)
export const feedbackApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    findAllFeedback: builder.query({
      query: ({ searchTerm = "", page = 1, limit = 10, isSolve = "" }) => ({
        url: "support/find_by_all_issues",
        method: "GET",
        params: {
          searchTerm,
          page,
          limit,
          sort: "-createdAt",
          ...(isSolve !== "" ? { isSolve } : {}),
        },
      }),
      providesTags: ["feedback"],
    }),
    setFeedbackResolved: builder.mutation({
      query: ({ id, isSolve }) => ({
        url: `support/resolve_issues/${id}`,
        method: "PATCH",
        body: { isSolve },
      }),
      invalidatesTags: ["feedback", "dashboard"],
    }),
    deleteFeedback: builder.mutation({
      query: (id) => ({
        url: `support/delete_support/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["feedback", "dashboard"],
    }),
  }),
});

export const {
  useFindAllFeedbackQuery,
  useSetFeedbackResolvedMutation,
  useDeleteFeedbackMutation,
} = feedbackApi;
