window.__marks = [];
for (const viewer of document.querySelectorAll("vive-pdf")) viewer.addEventListener("vive-mark", (event) => window.__marks.push(event.detail.name));
