// background.js
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("YouTube Transcript Extractor installed");
  } else if (details.reason === "update") {
    console.log(
      "YouTube Transcript Extractor updated to version",
      chrome.runtime.getManifest().version
    );
  }
});