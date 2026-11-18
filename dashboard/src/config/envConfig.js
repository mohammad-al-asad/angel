// Function to get the base API URL
export const imageUrl =
  import.meta.env.VITE_API_BASE_URL || "https://passengers-walk-gras-henderson.trycloudflare.com/";
export const url = `${imageUrl}api/v1/`;

export const getBaseUrl = () => {
  return url;
};

// Function to get the image base URL
export const getImageBaseUrl = () => {
  return imageUrl;
};

// export const socketUrl = "http://10.10.20.13:3056";
export const socketUrl = imageUrl.slice(0, -1); // remove the last / from the imageUrl

export const getSocketUrl = () => {
  return socketUrl;
};

// get up
export const getImageUrl = (imagePath) => {
  if (!imagePath) {
    return null; // or return a placeholder if you want
  }
  if (imagePath.includes("http")) {
    return imagePath;
  }
  return `${imageUrl}${imagePath}`;
};
