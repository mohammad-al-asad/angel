import { useState } from "react";
import Sidebar from "../shared/Sidebar/Sidebar";
import MainHeader from "../shared/MainHeader/MainHeader";
import { Outlet } from "react-router-dom";

const MainLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const closeSidebar = () => setIsSidebarOpen(false);

  return (
    <div className="flex flex-col z-50">
      <MainHeader toggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />
      <div className="flex w-full">
        <Sidebar isOpen={isSidebarOpen} toggleSidebar={toggleSidebar} closeSidebar={closeSidebar} />
        <main className="p-5 bg-white h-[100vh] w-full md:w-[85%] lg:w-[85%]">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
