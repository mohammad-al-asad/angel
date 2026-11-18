import { ConfigProvider, Input, Modal, Select, Table } from "antd";
import { useState, useEffect } from "react";
import { IoSearch } from "react-icons/io5";
import PageHeading from "../../components/PageHeading/PageHeading";
import { FaRegEye } from "react-icons/fa";
import { useFindAllSocialFeedReportsQuery } from "../../redux/api/socialReportsApi";
import {
  useDeleteSocialFeedReportMutation,
  useUpdateSocialFeedReportStatusMutation,
} from "../../redux/api/socialReportsApi";
import { getImageUrl } from "../../config/envConfig";
import { message } from "antd";
import { RiDeleteBin6Line } from "react-icons/ri";
import useDebounce from "../../hooks/useDebounce";

const REPORT_STATUS = {
  under_review: { label: "Under Review", className: "bg-yellow-100 text-yellow-800" },
  resolved: { label: "Resolved", className: "bg-green-100 text-green-800" },
  dismissed: { label: "Dismissed", className: "bg-gray-200 text-gray-700" },
};
const STATUS_OPTIONS = Object.entries(REPORT_STATUS).map(([value, s]) => ({ value, label: s.label }));
const reportStatus = (record) => (REPORT_STATUS[record?.status] ? record.status : "under_review");

// eslint-disable-next-line react/prop-types
function StatusBadge({ status }) {
  const s = REPORT_STATUS[status] || REPORT_STATUS.under_review;
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${s.className}`}>{s.label}</span>
  );
}

// eslint-disable-next-line react/prop-types
function PersonCell({ user, fallbackColor }) {
  // eslint-disable-next-line react/prop-types
  const name = user?.name || "Unknown User";
  // eslint-disable-next-line react/prop-types
  const email = user?.email || "N/A";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <img
        src={
          // eslint-disable-next-line react/prop-types
          getImageUrl(user?.photo) ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${fallbackColor}&color=fff`
        }
        className="w-8 h-8 object-cover rounded-full shrink-0"
        alt={name}
      />
      <div className="min-w-0">
        <p className="font-medium truncate" title={name}>{name}</p>
        <p className="text-xs text-gray-500 truncate" title={email}>{email}</p>
      </div>
    </div>
  );
}

function Reports() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reviewStatus, setReviewStatus] = useState("under_review");
  const [reviewNote, setReviewNote] = useState("");
  const [updateStatus, { isLoading: isUpdatingStatus }] =
    useUpdateSocialFeedReportStatusMutation();

  const changeStatus = async (record, status, adminNote) => {
    try {
      await updateStatus({ id: record._id, status, adminNote }).unwrap();
      message.success(
        status === "under_review"
          ? "Report moved back to Under Review"
          : `Report marked ${REPORT_STATUS[status].label}. The reporter has been notified.`
      );
      return true;
    } catch (error) {
      message.error(error?.data?.message || "Could not update the report status");
      return false;
    }
  };
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
  });
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const debouncedSearchTerm = useDebounce(searchTerm, 400);

  const [deleteReport, { isLoading: isDeleting }] =
    useDeleteSocialFeedReportMutation();

  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [reportToDelete, setReportToDelete] = useState(null);

  const handleDeleteReport = async () => {
    if (!reportToDelete) return;

    try {
      const result = await deleteReport(reportToDelete).unwrap();
      if (result.success) {
        message.success("Report deleted successfully");
        // Refresh the reports list by refetching
        // The query will automatically refetch because we've set up invalidatesTags
      } else {
        message.error(result.message || "Failed to delete report");
      }
    } catch (error) {
      console.error("Delete report error:", error);
      message.error(error.data?.message || "Failed to delete report");
    } finally {
      setDeleteConfirmVisible(false);
      setReportToDelete(null);
    }
  };

  const { data: reportsData, isLoading, isFetching } = useFindAllSocialFeedReportsQuery({
    searchTerm: debouncedSearchTerm,
    page: pagination.current,
    limit: pagination.pageSize,
    status: statusFilter,
  });

  useEffect(() => {
    if (reportsData?.data?.meta) {
      setPagination((prev) => ({
        ...prev,
        total: reportsData.data.meta.total || 0,
      }));
    }
  }, [reportsData]);

  const handleTableChange = (pagination) => {
    setPagination({
      current: pagination.current,
      pageSize: pagination.pageSize,
    });
  };

  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const showViewModal = (report) => {
    setSelectedReport(report);
    setReviewStatus(reportStatus(report));
    setReviewNote(report.adminNote || "");
    setIsViewModalOpen(true);
  };

  const saveReview = async () => {
    const ok = await changeStatus(selectedReport, reviewStatus, reviewNote.trim());
    if (ok) handleViewCancel();
  };

  const handleViewCancel = () => {
    setIsViewModalOpen(false);
    setSelectedReport(null);
  };

  const columns = [
    {
      title: "No",
      key: "no",
      width: 50,
      render: (_, __, index) =>
        (pagination.current - 1) * pagination.pageSize + index + 1,
    },
    {
      title: "Reported By",
      key: "reporter",
      width: 210,
      render: (_, record) => <PersonCell user={record.userId} fallbackColor="00c0b5" />,
    },
    {
      title: "Reported User",
      key: "reportedUser",
      width: 210,
      render: (_, record) => (
        <PersonCell user={record.event_postId?.userId} fallbackColor="00a89b" />
      ),
    },
    {
      title: "Reason",
      dataIndex: "reason",
      key: "reason",
      width: 170,
      render: (reason) => (
        <span className="line-clamp-2" title={reason}>
          {reason}
        </span>
      ),
    },
    {
      title: "Reported On",
      key: "createdAt",
      width: 110,
      render: (_, record) => (
        <span className="whitespace-nowrap">{new Date(record.createdAt).toLocaleDateString()}</span>
      ),
    },
    {
      title: "Status",
      key: "status",
      width: 150,
      render: (_, record) => {
        const value = reportStatus(record);
        return (
          <div className={`inline-flex items-center rounded-full ${REPORT_STATUS[value].className}`}>
            <Select
              size="small"
              variant="borderless"
              value={value}
              onChange={(next) => changeStatus(record, next)}
              disabled={isUpdatingStatus}
              options={STATUS_OPTIONS}
              popupMatchSelectWidth={false}
              className="report-status-select"
              labelRender={({ label }) => (
                <span className={`text-xs font-medium ${REPORT_STATUS[value].className.split(" ")[1]}`}>
                  {label}
                </span>
              )}
              optionRender={(option) => <StatusBadge status={option.value} />}
            />
          </div>
        );
      },
    },
    {
      title: "Action",
      key: "action",
      width: 80,
      fixed: "right",
      render: (_, record) => (
        <div className="flex gap-2">
          
          <button
            onClick={() => showViewModal(record)}
            className="text-[#00c0b5] hover:text-[#00a89b] transition-colors"
            title="View Details"
          >
            <FaRegEye className="w-5 h-5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setReportToDelete(record._id);
              setDeleteConfirmVisible(true);
            }}
            className="text-red-500 hover:text-red-700 transition-colors"
            title="Delete Report"
            disabled={isDeleting}
          >
            <RiDeleteBin6Line className="w-5 h-5" />
          </button>
        </div>
      ),
    },
  ];






  return (
    <div>
      <div className="my-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <PageHeading title="Reports" />
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
        <Select
          value={statusFilter}
          onChange={(value) => {
            setStatusFilter(value);
            setPagination((prev) => ({ ...prev, current: 1 }));
          }}
          options={[{ value: "", label: "All statuses" }, ...STATUS_OPTIONS]}
          className="w-full sm:w-[160px]"
          size="large"
        />
        <div className="relative w-full sm:w-[300px]">
          <input
            type="text"
            placeholder="Search reports..."
            className="border border-[#e5eaf2] py-3 pl-12 pr-4 outline-none w-full rounded-md"
            value={searchTerm}
            onChange={handleSearch}
          />
          <span className="text-gray-500 absolute top-0 left-0 h-full px-3 flex items-center justify-center cursor-pointer">
            <IoSearch className="text-[1.3rem]" />
          </span>
        </div>
        </div>
      </div>

      <ConfigProvider
        theme={{
          components: {
            Table: {
              headerBg: "#00c0b5",
              headerColor: "rgb(255,255,255)",
              cellFontSize: 14,
              cellPaddingInline: 12,
              headerSplitColor: "#00c0b5",
            },
          },
        }}
      >
        <Table
          columns={columns}
          dataSource={reportsData?.data?.allmessage || []}
          rowKey="_id"
          loading={isLoading || isFetching}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: false,
            pageSizeOptions: ["10", "20", "50", "100"],
          }}
          onChange={handleTableChange}
          scroll={{ x: 980 }}
          tableLayout="fixed"
        />
      </ConfigProvider>


        {/* Delete Confirmation Modal */}
      <Modal
        title="Confirm Delete"
        open={deleteConfirmVisible}
        onOk={handleDeleteReport}
        onCancel={() => {
          setDeleteConfirmVisible(false);
          setReportToDelete(null);
        }}
        okText="Delete"
        cancelText="Cancel"
        okButtonProps={{ 
          danger: true, 
          loading: isDeleting,
          disabled: isDeleting
        }}
        cancelButtonProps={{ disabled: isDeleting }}
      >
        <p>Are you sure you want to delete this report? This action cannot be undone.</p>
      </Modal>




      {/* Report Details Modal */}
      <Modal
        open={isViewModalOpen}
        title="Report Details"
        centered
        onCancel={handleViewCancel}
        footer={null}
        width={800}
      >
        {selectedReport && (
          <div className="space-y-6">
            {/* Header */}
            <div className="bg-gradient-to-r from-[#00c0b5] to-[#00a89b] p-6 -m-6 mb-6 mt-6 rounded-t-lg">
              <h2 className="text-2xl font-bold text-white">Report Details</h2>
              <p className="text-white/90">ID: {selectedReport._id}</p>
            </div>

            {/* Reporter and Reported User */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-medium text-gray-700 mb-3">Reporter</h3>
                <div className="flex items-center gap-3">
                  <img
                    src={
                      getImageUrl(selectedReport.userId?.photo) ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        selectedReport.userId?.name || "U"
                      )}&background=00c0b5&color=fff`
                    }
                    className="w-12 h-12 object-cover rounded-full"
                    alt="Reporter"
                  />
                  <div>
                    <p className="font-medium">
                      {selectedReport.userId?.name || "Unknown User"}
                    </p>
                    <p className="text-sm text-gray-500">
                      {selectedReport.userId?.email}
                    </p>
                    <p className="text-sm text-gray-500">
                      {selectedReport.userId?.phoneNumber}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-medium text-gray-700 mb-3">
                  Reported User
                </h3>
                <div className="flex items-center gap-3">
                  <img
                    src={
                      getImageUrl(selectedReport.event_postId?.userId?.photo) ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        selectedReport.event_postId?.userId?.name || "U"
                      )}&background=00a89b&color=fff`
                    }
                    className="w-12 h-12 object-cover rounded-full"
                    alt="Reported User"
                  />
                  <div>
                    <p className="font-medium">
                      {selectedReport.event_postId?.userId?.name ||
                        "Unknown User"}
                    </p>
                    <p className="text-sm text-gray-500">
                      {selectedReport.event_postId?.userId?.email || "N/A"}
                    </p>
                    <p className="text-sm text-gray-500">
                      {selectedReport.event_postId?.userId?.phoneNumber ||
                        "N/A"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Report Details */}
            <div className="space-y-4">
              <div>
                <h3 className="font-medium text-gray-700 mb-2">
                  Reason for Report
                </h3>
                <p className="bg-gray-50 p-3 rounded-lg">
                  {selectedReport.reason}
                </p>
              </div>

              <div>
                <h3 className="font-medium text-gray-700 mb-2">
                  Additional Details
                </h3>
                <p className="bg-gray-50 p-3 rounded-lg whitespace-pre-line">
                  {selectedReport.details || "No additional details provided."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="font-medium text-gray-700 mb-1">
                    Reported On
                  </h3>
                  <p>{new Date(selectedReport.createdAt).toLocaleString()}</p>
                </div>
                <div>
                  <h3 className="font-medium text-gray-700 mb-1">Current status</h3>
                  <StatusBadge status={reportStatus(selectedReport)} />
                  {selectedReport.reviewedAt && (
                    <p className="text-xs text-gray-500 mt-1">
                      Reviewed {new Date(selectedReport.reviewedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              {/* Review */}
              <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                <h3 className="font-medium text-gray-700">Review this report</h3>
                <Select
                  value={reviewStatus}
                  onChange={setReviewStatus}
                  options={STATUS_OPTIONS}
                  className="w-full sm:w-[220px]"
                />
                <Input.TextArea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  maxLength={500}
                  showCount
                  rows={3}
                  placeholder="Optional note for the reporter, e.g. 'The post was removed.'"
                />
                <p className="text-xs text-gray-500">
                  The reporter gets a notification when you mark the report Resolved or Dismissed.
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 mt-6">
              <button
                onClick={handleViewCancel}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Close
              </button>
              <button
                onClick={saveReview}
                disabled={isUpdatingStatus}
                className="px-6 py-2 rounded-lg bg-[#00c0b5] text-white hover:bg-[#00a89b] transition-colors font-medium disabled:opacity-60"
              >
                {isUpdatingStatus ? "Saving..." : "Save review"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Reports;
