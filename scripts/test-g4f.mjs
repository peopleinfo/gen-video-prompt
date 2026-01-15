import http from "node:http";

async function testG4F() {
  const payload = {
    provider: "gpt4free",
    story: "A cute cat playing in the garden",
    gpt4free: {
      model: "gpt-4o",
    },
  };

  const options = {
    hostname: "127.0.0.1",
    port: 3333,
    path: "/api/generate",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode === 200 && json.ok) {
            console.log("✅ G4F Chat completion test passed!");
            console.log("Response preview:", json.text?.slice(0, 100) + "...");
            resolve(true);
          } else {
            console.error("❌ G4F Chat completion test failed!");
            console.error("Status:", res.statusCode);
            console.error("Response:", json);
            resolve(false);
          }
        } catch (e) {
          console.error("❌ Failed to parse response:", data);
          resolve(false);
        }
      });
    });

    req.on("error", (e) => {
      console.error(`❌ Request error: ${e.message}`);
      resolve(false);
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function testG4FImage() {
  const payload = {
    prompt: "A beautiful sunset over the ocean",
    config: {
      provider: "gpt4free",
      model: "flux-2-pro",
    },
  };

  const options = {
    hostname: "127.0.0.1",
    port: 3333,
    path: "/api/generate-image",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode === 200 && json.choices?.[0]?.message?.content) {
            console.log("✅ G4F Image generation test passed!");
            console.log(
              "Image URL/Data:",
              json.choices[0].message.content.slice(0, 100) + "..."
            );
            resolve(true);
          } else {
            console.error("❌ G4F Image generation test failed!");
            console.error("Status:", res.statusCode);
            console.error("Response:", json);
            resolve(false);
          }
        } catch (e) {
          console.error("❌ Failed to parse response:", data);
          resolve(false);
        }
      });
    });

    req.on("error", (e) => {
      console.error(`❌ Request error: ${e.message}`);
      resolve(false);
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function run() {
  console.log("Starting G4F Smoke Tests...");
  const chatOk = await testG4F();
  const imgOk = await testG4FImage();

  if (chatOk && imgOk) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

run();
