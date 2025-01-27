// Copyright (C) 2020  Matthew "strager" Glazar
// See end of file for extended copyright information.

import axios from "axios";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { listenAsync, urlFromServerAddress } from "../src/net.mjs";
import { makeServer } from "../src/server.mjs";

describe("server", () => {
  let request;
  let server;
  let wwwRootPath;

  beforeEach(async () => {
    wwwRootPath = fs.mkdtempSync(os.tmpdir() + path.sep);

    server = http.createServer(
      makeServer({
        esbuildBundles: {
          "/app.bundle.js": {
            entryPoints: ["/app.js"],
          },
        },
        htmlRedirects: {
          "/redirect-from.html": "redirect-to/",
        },
        wwwRootPath: wwwRootPath,
      })
    );
    await listenAsync(server, { host: "localhost", port: 0 });
    request = axios.create({
      baseURL: urlFromServerAddress(server.address()).toString(),
      responseType: "text",
      validateStatus: (_status) => true,
    });
  });

  afterEach(async () => {
    server.close();
    fs.rmSync(wwwRootPath, { recursive: true });
  });

  describe("/", () => {
    it("serves index.html", async () => {
      fs.writeFileSync(path.join(wwwRootPath, "index.html"), "hello world");

      let response = await request.get("/");
      expect(response.data).toBe("hello world");
      expect(response.headers["content-type"]).toBe("text/html");
    });

    it("serves index.ejs.html", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "index.ejs.html"),
        "hello <%= 2+2 %>"
      );

      let response = await request.get("/");
      expect(response.data).toBe("hello 4");
      expect(response.headers["content-type"]).toBe("text/html");
    });

    it("fails if both index.html and index.ejs.html exist", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "index.ejs.html"),
        "hello <%= 2+2 %>"
      );
      fs.writeFileSync(path.join(wwwRootPath, "index.html"), "hello world");

      let response = await request.get("/");
      expect(response.status).toBe(409);
    });

    it("fails if neither index.html nor index.ejs.html exist", async () => {
      // Don't create any files in wwwRootPath.

      let response = await request.get("/");
      expect(response.status).toBe(404);
    });
  });

  describe("/testdir/", () => {
    it("serves index.html", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "testdir"));
      fs.writeFileSync(
        path.join(wwwRootPath, "testdir", "index.html"),
        "hello world"
      );

      let response = await request.get("/testdir/");
      expect(response.data).toBe("hello world");
      expect(response.headers["content-type"]).toBe("text/html");
    });

    it("serves index.ejs.html", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "testdir"));
      fs.writeFileSync(
        path.join(wwwRootPath, "testdir", "index.ejs.html"),
        "hello <%= 2+2 %>"
      );

      let response = await request.get("/testdir/");
      expect(response.data).toBe("hello 4");
      expect(response.headers["content-type"]).toBe("text/html");
    });

    it("fails if both index.html and index.ejs.html exist", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "testdir"));
      fs.writeFileSync(
        path.join(wwwRootPath, "testdir", "index.ejs.html"),
        "hello <%= 2+2 %>"
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "testdir", "index.html"),
        "hello world"
      );

      let response = await request.get("/testdir/");
      expect(response.status).toBe(409);
    });

    it("fails if neither index.html nor index.ejs.html exist", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "testdir"));
      // Don't create any files in ${wwwRootPath}/testdir.

      let response = await request.get("/testdir/");
      expect(response.status).toBe(404);
    });

    it("fails if directory does not exist", async () => {
      // Don't create ${wwwRootPath}/testdir.

      let response = await request.get("/testdir/");
      expect(response.status).toBe(404);
    });
  });

  describe("/outer/inner/nested/", () => {
    it("serves index.html", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "outer", "inner", "nested"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(wwwRootPath, "outer", "inner", "nested", "index.html"),
        "hello world"
      );

      let response = await request.get("/outer/inner/nested/");
      expect(response.data).toBe("hello world");
      expect(response.headers["content-type"]).toBe("text/html");
    });
  });

  it("/testdir without trailing '/' 404s despite presence of index.html", async () => {
    fs.mkdirSync(path.join(wwwRootPath, "testdir"));
    fs.writeFileSync(
      path.join(wwwRootPath, "testdir", "index.html"),
      "hello world"
    );
    fs.writeFileSync(
      path.join(wwwRootPath, "testdirindex.html"),
      "hello world"
    );

    let response = await request.get("/testdir");
    expect(response.status).toBe(404);
  });

  // index.html should only be served through its containing directory.
  for (let testPath of ["/index.html", "/index.ejs.html"]) {
    describe(testPath, () => {
      it("fails despite presence of index.html", async () => {
        fs.writeFileSync(path.join(wwwRootPath, "index.html"), "hello world");

        let response = await request.get(testPath);
        expect(response.status).toBe(404);
      });

      it("fails despite presence of index.ejs.html", async () => {
        fs.writeFileSync(
          path.join(wwwRootPath, "index.ejs.html"),
          "hello <%= 2+2 %>"
        );

        let response = await request.get(testPath);
        expect(response.status).toBe(404);
      });
    });
  }

  describe("/generated/<subdir>/", () => {
    it("serves index.ejs.html for /generated/, ignoring index.mjs", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "generated"));
      fs.writeFileSync(
        path.join(wwwRootPath, "generated", "index.mjs"),
        "export let routes = { '/generated/subdir/': 'page.ejs.html' };"
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "generated", "index.ejs.html"),
        "hello <%= 2+2 %>"
      );

      let response = await request.get("/generated/");
      expect(response.data).toBe("hello 4");
      expect(response.headers["content-type"]).toBe("text/html");
    });

    it("doesn't serves index.mjs", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "generated"));
      fs.writeFileSync(
        path.join(wwwRootPath, "generated", "index.mjs"),
        "export let routes = { '/generated/subdir/': 'page.ejs.html' };"
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "generated", "index.ejs.html"),
        "hello <%= 2+2 %>"
      );

      let response = await request.get("/generated/index.mjs");
      expect(response.status).toBe(404);
    });

    it("loads .ejs.html route mentioned in /generated/index.mjs", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "generated"));
      fs.writeFileSync(
        path.join(wwwRootPath, "generated", "index.mjs"),
        "export let routes = { '/generated/subdir/': 'page.ejs.html' };"
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "generated", "page.ejs.html"),
        "current URI is <%- currentURI %>"
      );

      let response = await request.get("/generated/subdir/");
      expect(response.status).toBe(200);
      expect(response.data).toBe("current URI is /generated/subdir/");
      expect(response.headers["content-type"]).toBe("text/html");
    });

    it("fails if both /generated/subdir/index.ejs/html exists, and /generated/subdir/ is routed by /generated/index.js", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "generated"));
      fs.mkdirSync(path.join(wwwRootPath, "generated", "subdir"));
      fs.writeFileSync(
        path.join(wwwRootPath, "generated", "subdir", "index.ejs.html"),
        "filesystem page should not load"
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "generated", "index.mjs"),
        "export let routes = { '/generated/subdir/': 'page.ejs.html' };"
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "generated", "page.ejs.html"),
        "routed page should not load"
      );

      let response = await request.get("/generated/subdir/");
      expect(response.status).toBe(409);
    });

    it("fails if /generated/index.mjs does not mention route", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "generated"));
      fs.writeFileSync(
        path.join(wwwRootPath, "generated", "index.mjs"),
        "export let routes = { '/generated/other/': 'page.ejs.html' };"
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "generated", "page.ejs.html"),
        "this page should not load"
      );

      let response = await request.get("/generated/subdir/");
      expect(response.status).toBe(404);
    });
  });

  describe("regular files", () => {
    it("/test.png", async () => {
      fs.writeFileSync(path.join(wwwRootPath, "test.png"), "hello PNG");

      let response = await request.get("/test.png");
      expect(response.status).toBe(200);
      expect(response.data).toBe("hello PNG");
      expect(response.headers["content-type"]).toBe("image/png");
    });

    it("/test.js", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "test.js"),
        "console.log('hello')"
      );

      let response = await request.get("/test.js");
      expect(response.status).toBe(200);
      expect(response.data).toBe("console.log('hello')");
      expect(response.headers["content-type"]).toBe("application/javascript");
    });

    it("/test.tar.bz2 (multiple file extensions)", async () => {
      fs.writeFileSync(path.join(wwwRootPath, "test.tar.bz2"), "cmprssd dt");

      let response = await request.get("/test.tar.bz2");
      expect(response.status).toBe(200);
      expect(response.data).toBe("cmprssd dt");
      expect(response.headers["content-type"]).toBe("application/x-bzip2");
    });

    it("/doesnotexist.js gives 404 Not Found", async () => {
      // Do not create /doesnotexist.js.

      let response = await request.get("/doesnotexist.js");
      expect(response.status).toBe(404);
    });
  });

  describe("files without an extension", () => {
    it("should 404 even if they exist", async () => {
      fs.writeFileSync(path.join(wwwRootPath, "testfile"), "hello world");

      let response = await request.get("/testfile");
      expect(response.status).toBe(404);
    });
  });

  describe("dotfiles (hidden files)", () => {
    it("should 404 even if they exist", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "test.js"),
        "console.log('hello')"
      );
      fs.writeFileSync(
        path.join(wwwRootPath, ".test.js"),
        "console.log('hello')"
      );

      let response = await request.get("/.test.js");
      expect(response.status).toBe(404);
    });
  });

  describe(".htaccess (Apache configuration)", () => {
    it("should 403 if it exists", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, ".htaccess"),
        'Header add Link "</main.css>;rel=preload"'
      );

      let response = await request.get("/.htaccess");
      expect(response.status).toBe(403);
    });
  });

  describe(". components", () => {
    it("/./ should 404 even if / works", async () => {
      fs.writeFileSync(path.join(wwwRootPath, "index.html"), "hello world");

      let response = await request.get("/./");
      expect(response.status).toBe(404);
    });

    it("/./test.js should 404 even if /test.js works", async () => {
      fs.writeFileSync(path.join(wwwRootPath, "test.js"), "hello()");

      let response = await request.get("/./test.js");
      expect(response.status).toBe(404);
    });
  });

  describe(".. components", () => {
    it("/../ should 404 even if / works", async () => {
      fs.writeFileSync(path.join(wwwRootPath, "index.html"), "hello world");

      let response = await request.get("/../");
      expect(response.status).toBe(404);
    });

    it("/../test.js should 404 even if /test.js works", async () => {
      fs.writeFileSync(path.join(wwwRootPath, "test.js"), "hello()");

      let response = await request.get("/../test.js");
      expect(response.status).toBe(404);
    });

    it("/subdir/../test.js should 404 even if /subdir/ and /test.js both work", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "subdir"));
      fs.writeFileSync(path.join(wwwRootPath, "test.js"), "hello()");
      fs.writeFileSync(
        path.join(wwwRootPath, "subdir", "index.html"),
        "hello world"
      );
      fs.writeFileSync(path.join(wwwRootPath, "subdir", "test.js"), "hello()");

      let response = await request.get("/subdir/../test.js");
      expect(response.status).toBe(404);
    });
  });

  describe("node_modules", () => {
    it("/node_modules/ should 404 even if index.html exists", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "node_modules"));
      fs.writeFileSync(
        path.join(wwwRootPath, "node_modules", "index.html"),
        "hello world"
      );

      let response = await request.get("/node_modules/");
      expect(response.status).toBe(404);
    });

    it("/node_modules/test.js should 404 even if node_modules/test.js exists", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "node_modules"));
      fs.writeFileSync(
        path.join(wwwRootPath, "node_modules", "test.js"),
        "hello()"
      );

      let response = await request.get("/node_modules/test.js");
      expect(response.status).toBe(404);
    });
  });

  describe("HTML redirects", () => {
    it("should send 200 with refreshing HTML", async () => {
      let response = await request.get("/redirect-from.html");
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("text/html");
      expect(response.data).toContain(
        '<meta http-equiv="refresh" content="0; url=redirect-to/" />'
      );
    });
  });

  describe("esbuild bundle", () => {
    it("should preserve simple script", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "app.js"),
        'console.log("hello world")'
      );

      let response = await request.get("/app.bundle.js");
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/javascript");
      expect(response.data).toContain('console.log("hello world")');
    });

    it("should bundle imported files", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "app.js"),
        'import { greet } from "./lib.js"; greet();'
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "lib.js"),
        'export function greet() { console.log("hello world"); }'
      );

      let response = await request.get("/app.bundle.js");
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/javascript");
      expect(response.data).toContain('console.log("hello world")');
      expect(response.data).toContain("greet");
      expect(response.data).not.toContain("import");
    });

    it("syntax error causes 500 error", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "app.js"),
        "syntax error goes here !@#%$^"
      );

      let response = await request.get("/app.bundle.js");
      expect(response.status).toBe(500);
      expect(response.data).toContain("Build failed with 1 error");
    });
  });

  describe("EJS", () => {
    it("exception causes 500 error", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "index.ejs.html"),
        "<%= variableDoesNotExist %>"
      );

      let response = await request.get("/");
      expect(response.status).toBe(500);
      expect(response.data).toContain("variableDoesNotExist");
    });

    it("currentURI refers to relative URI", async () => {
      fs.mkdirSync(path.join(wwwRootPath, "subdir"));
      fs.writeFileSync(
        path.join(wwwRootPath, "index.ejs.html"),
        "<%- currentURI %>"
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "subdir", "index.ejs.html"),
        "<%- currentURI %>"
      );

      let response = await request.get("/");
      expect(response.data).toBe("/");

      response = await request.get("/subdir/");
      expect(response.data).toBe("/subdir/");
    });

    it("currentURI ignores query parameters", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "index.ejs.html"),
        "<%- currentURI %>"
      );

      let response = await request.get("/?key=value");
      expect(response.data).toBe("/");
    });

    it("included template can refer to relative paths", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "index.ejs.html"),
        "<%- await include('./dir/included.ejs.html') %>"
      );
      fs.mkdirSync(path.join(wwwRootPath, "dir"));
      fs.writeFileSync(
        path.join(wwwRootPath, "dir/included.ejs.html"),
        `<%
          let url = await import("url");
          let { hello } = await import(url.pathToFileURL("./hello.mjs"));
          __append(hello());
        %>`
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "dir/hello.mjs"),
        "export function hello() { return 'hi'; }"
      );

      let response = await request.get("/");
      expect(response.data).toBe("hi");
    });

    it("including does not affect later imports", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "index.ejs.html"),
        `<%
          __append(await include("./dir-a/included-a.ejs.html"));
          __append(" ");
          let url = await import("url");
          let { hello } = await import(url.pathToFileURL("./dir-b/hello-b.mjs"));
          __append(hello());
        %>`
      );
      fs.mkdirSync(path.join(wwwRootPath, "dir-a"));
      fs.writeFileSync(
        path.join(wwwRootPath, "dir-a/included-a.ejs.html"),
        `<%
          let url = await import("url");
          let { hello } = await import(url.pathToFileURL("./hello-a.mjs"));
          __append(hello());
        %>`
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "dir-a/hello-a.mjs"),
        "export function hello() { return 'hi-a'; }"
      );
      fs.mkdirSync(path.join(wwwRootPath, "dir-b"));
      fs.writeFileSync(
        path.join(wwwRootPath, "dir-b/hello-b.mjs"),
        "export function hello() { return 'hi-b'; }"
      );

      let response = await request.get("/");
      expect(response.data).toBe("hi-a hi-b");
    });
  });

  describe("HEAD request", () => {
    it("does not run index.ejs.html", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "index.ejs.html"),
        "<%= syntax error goes here %>"
      );

      let response = await request.head("/");
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("text/html");
    });

    it("fails for missing index.html and index.ejs.html", async () => {
      // Don't create index.html or index.ejs.html

      let response = await request.head("/");
      expect(response.status).toBe(404);
    });

    it("does not run page.ejs.html routed by index.mjs", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "index.mjs"),
        "export let routes = { '/generated-page/': 'page.ejs.html' };"
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "page.ejs.html"),
        "<%= syntax error goes here %>"
      );

      let response = await request.head("/generated-page/");
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("text/html");
    });

    it("returns 404 for URI not routed by index.mjs", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "index.mjs"),
        "export let routes = { '/generated-page/': 'page.ejs.html' };"
      );
      fs.writeFileSync(
        path.join(wwwRootPath, "page.ejs.html"),
        "this page should not be loaded"
      );

      let response = await request.head("/other-page/");
      expect(response.status).toBe(404);
    });

    it("serves PNG file", async () => {
      fs.writeFileSync(
        path.join(wwwRootPath, "file.png"),
        "(PNG data goes here)"
      );

      let response = await request.head("/file.png");
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("image/png");
    });

    it("fails for missing PNG file", async () => {
      // Don't create file.png.

      let response = await request.head("/file.png");
      expect(response.status).toBe(404);
    });
  });
});

// quick-lint-js finds bugs in JavaScript programs.
// Copyright (C) 2020  Matthew "strager" Glazar
//
// This file is part of quick-lint-js.
//
// quick-lint-js is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// quick-lint-js is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with quick-lint-js.  If not, see <https://www.gnu.org/licenses/>.
