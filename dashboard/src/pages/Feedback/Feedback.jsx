import { ConfigProvider, Modal, Select, Table, message } from "antd";
import { useEffect, useState } from "react";
import { IoSearch } from "react-icons/io5";
import { FaRegEye } from "react-icons/fa";
import { RiDeleteBin6Line } from "react-icons/ri";
import PageHeading from "../../components/PageHeading/PageHeading";
import useDebounce from "../../hooks/useDebounce";
import {
  useDeleteFeedbackMutation,
  useFindAllFeedbackQuery,
  useSetFeedbackResolvedMutation,
} from "../../redux/api/feedbackApi";

const STATUS_FILTERS = [
  { value: "", label: "All feedback" },
  { value: "false", label: "Open" },
  { value: "true", label: "Resolved" },
];

function StatusBadge({ resolved }) {
  return resolved ? (
    <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
      Resolved
    </span>
  ) : (
    <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
      Open
    </span>
  );
}

function Feedback() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [selected, setSelected] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const debouncedSearchTerm = useDebounce(searchTerm, 400);

  const { data, isLoading, isFetching } = useFindAllFeedbackQuery({
    searchTerm: debouncedSearchTerm,
    page: pagination.current,
    limit: pagination.pageSize,
    isSolve: statusFilter,
  });
  const [setResolved, { isLoading: isSaving }] = useSetFeedbackResolvedMutation();
  const [deleteFeedback, { isLoading: isDeleting }] = useDeleteFeedbackMutation();

  const rows = data?.data?.data || [];

  useEffect(() => {
    if (data?.data?.meta) {
      setPagination((prev) => ({ ...prev, total: data.data.meta.total || 0 }));
    }
  }, [data]);

  const toggleResolved = async (record) => {
    try {
      await setResolved({ id: record._id, isSolve: !record.isSolve }).unwrap();
      message.success(
        record.isSolve ? "Marked as open" : "Marked as resolved. The user has been notified."
      );
      if (selected?._id === record._id) {
        setSelected({ ...record, isSolve: !record.isSolve });
      }
    } catch (error) {
      message.error(error?.data?.message || "Could not update feedback");
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteFeedback(toDelete).unwrap();
      message.success("Feedback deleted");
    } catch (error) {
      message.error(error?.data?.message || "Could not delete feedback");
    } finally {
      setToDelete(null);
    }
  };

  const columns = [
    {
      title: "No",
      key: "no",
      render: (_, __, index) => (pagination.current - 1) * pagination.pageSize + index + 1,
    },
    {
      title: "From",
      key: "from",
      render: (_, record) => (
        <div>
          <p className="font-medium">{record.userId?.name || record.name}</p>
          <p className="text-sm text-gray-500">{record.userId?.email || record.email}</p>
        </div>
      ),
    },
    {
      title: "Subject",
      dataIndex: "subject",
      key: "subject",
      render: (subject) => (
        <span className="line-clamp-1 max-w-[220px] inline-block" title={subject}>
          {subject}
        </span>
      ),
    },
    {
      title: "Message",
      dataIndex: "message",
      key: "message",
      render: (text) => (
        <span className="line-clamp-1 max-w-[320px] inline-block text-gray-600" title={text}>
          {text}
        </span>
      ),
    },
    {
      title: "Received",
      key: "createdAt",
      render: (_, record) => new Date(record.createdAt).toLocaleDateString(),
    },
    {
      title: "Status",
      key: "status",
      render: (_, record) => <StatusBadge resolved={record.isSolve} />,
    },
    {
      title: "Action",
      key: "action",
      render: (_, record) => (
        <div className="flex gap-3 items-center">
          <button
            onClick={() => setSelected(record)}
            className="text-[#00c0b5] hover:text-[#00a89b]"
            title="View"
          >
            <FaRegEye className="w-5 h-5" />
          </button>
          <button
            onClick={() => toggleResolved(record)}
            disabled={isSaving}
            className="text-sm px-3 py-1 rounded-md border border-[#00c0b5] text-[#00a89b] hover:bg-[#00c0b5] hover:text-white transition-colors"
          >
            {record.isSolve ? "Reopen" : "Mark resolved"}
          </button>
          <button
            onClick={() => setToDelete(record._id)}
            className="text-red-500 hover:text-red-700"
            title="Delete"
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
        <PageHeading title="Feedback" />
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <Select
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setPagination((prev) => ({ ...prev, current: 1 }));
            }}
            options={STATUS_FILTERS}
            className="w-full sm:w-[160px]"
            size="large"
          />
          <div className="relative w-full sm:w-[300px]">
            <input
              type="text"
              placeholder="Search feedback..."
              className="border border-[#e5eaf2] py-3 pl-12 pr-4 outline-none w-full rounded-md"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
            />
            <span className="text-gray-500 absolute top-0 left-0 h-full px-3 flex items-center">
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
              cellFontSize: 16,
              headerSplitColor: "#00c0b5",
            },
          },
        }}
      >
        <Table
          columns={columns}
          dataSource={rows}
          rowKey="_id"
          loading={isLoading || isFetching}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: false,
          }}
          onChange={(p) => setPagination((prev) => ({ ...prev, current: p.current, pageSize: p.pageSize }))}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "No feedback yet" }}
        />
      </ConfigProvider>

      <Modal
        open={!!selected}
        title="Feedback details"
        centered
        onCancel={() => setSelected(null)}
        footer={null}
        width={700}
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex justify-between items-start gap-4">
              <div>
                <p className="font-medium">{selected.userId?.name || selected.name}</p>
                <p className="text-sm text-gray-500">{selected.userId?.email || selected.email}</p>
                {selected.userId?.phoneNumber && (
                  <p className="text-sm text-gray-500">{selected.userId.phoneNumber}</p>
                )}
              </div>
              <StatusBadge resolved={selected.isSolve} />
            </div>
            <div>
              <h3 className="font-medium text-gray-700 mb-1">Subject</h3>
              <p className="bg-gray-50 p-3 rounded-lg">{selected.subject}</p>
            </div>
            <div>
              <h3 className="font-medium text-gray-700 mb-1">Message</h3>
              <p className="bg-gray-50 p-3 rounded-lg whitespace-pre-line">{selected.message}</p>
            </div>
            <p className="text-sm text-gray-500">
              Received {new Date(selected.createdAt).toLocaleString()}
            </p>
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button
                onClick={() => setSelected(null)}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
              <button
                onClick={() => toggleResolved(selected)}
                disabled={isSaving}
                className="px-6 py-2 rounded-lg bg-[#00c0b5] text-white hover:bg-[#00a89b] disabled:opacity-60"
              >
                {selected.isSolve ? "Reopen" : "Mark resolved"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title="Delete feedback"
        open={!!toDelete}
        onOk={handleDelete}
        onCancel={() => setToDelete(null)}
        okText="Delete"
        okButtonProps={{ danger: true, loading: isDeleting }}
      >
        <p>Delete this feedback message? This can&apos;t be undone.</p>
      </Modal>
    </div>
  );
}

export default Feedback;
