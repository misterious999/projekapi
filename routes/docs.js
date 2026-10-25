'use strict';

const express = require('express');
const { app, categories, endpoints } = require('../config/app');
const store = require('../lib/store');

const router = express.Router();

function exampleQuery(endpoint) {
  const params = endpoint.params.filter((item) => item.example !== undefined && item.required);
  if (!params.length) return '';
  return '?' + params.map((item) => `${encodeURIComponent(item.name)}=${encodeURIComponent(item.example)}`).join('&');
}

function exampleBody(endpoint) {
  const body = {};
  for (const param of endpoint.params) {
    if (param.example !== undefined) body[param.name] = param.example;
  }
  return JSON.stringify(body, null, 2);
}

function buildExamples(endpoint, baseUrl) {
  const fullUrl = baseUrl + endpoint.path + exampleQuery(endpoint);
  const headers = { Authorization: 'Bearer YOUR_API_KEY' };
  const isPost = endpoint.method === 'POST';

  const curl = isPost
    ? `curl -X POST "${baseUrl}${endpoint.path}" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${exampleBody(endpoint).replace(/\n/g, '\n  ')}'`
    : `curl "${fullUrl}" \\\n  -H "Authorization: Bearer YOUR_API_KEY"`;

  const js = isPost
    ? `const response = await fetch("${baseUrl}${endpoint.path}", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_KEY",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify(${exampleBody(endpoint)})\n});\n\nconst data = await response.json();\nconsole.log(data);`
    : `const response = await fetch("${fullUrl}", {\n  headers: { "Authorization": "Bearer YOUR_API_KEY" }\n});\n\nconst data = await response.json();\nconsole.log(data);`;

  const python = isPost
    ? `import requests\n\nurl = "${baseUrl}${endpoint.path}"\nheaders = {"Authorization": "Bearer YOUR_API_KEY"}\npayload = ${exampleBody(endpoint).replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False')}\n\nresponse = requests.post(url, headers=headers, json=payload)\nprint(response.json())`
    : `import requests\n\nurl = "${fullUrl}"\nheaders = {"Authorization": "Bearer YOUR_API_KEY"}\n\nresponse = requests.get(url, headers=headers)\nprint(response.json())`;

  const php = isPost
    ? `<?php\n$ch = curl_init("${baseUrl}${endpoint.path}");\ncurl_setopt_array($ch, [\n  CURLOPT_POST => true,\n  CURLOPT_RETURNTRANSFER => true,\n  CURLOPT_HTTPHEADER => [\n    "Authorization: Bearer YOUR_API_KEY",\n    "Content-Type: application/json"\n  ],\n  CURLOPT_POSTFIELDS => json_encode(${exampleBody(endpoint)})\n]);\n$response = curl_exec($ch);\ncurl_close($ch);\necho $response;`
    : `<?php\n$ch = curl_init("${fullUrl}");\ncurl_setopt_array($ch, [\n  CURLOPT_RETURNTRANSFER => true,\n  CURLOPT_HTTPHEADER => ["Authorization: Bearer YOUR_API_KEY"]\n]);\n$response = curl_exec($ch);\ncurl_close($ch);\necho $response;`;

  const node = isPost
    ? `const res = await fetch("${baseUrl}${endpoint.path}", {\n  method: "POST",\n  headers: {\n    Authorization: "Bearer YOUR_API_KEY",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify(${exampleBody(endpoint)})\n});\nconsole.log(await res.json());`
    : `const res = await fetch("${fullUrl}", {\n  headers: { Authorization: "Bearer YOUR_API_KEY" }\n});\nconsole.log(await res.json());`;

  return { curl, javascript: js, python, php, node };
}

router.get('/', async (req, res, next) => {
  try {
    const clientEndpoints = endpoints.map((endpoint) => ({
      id: endpoint.id,
      category: endpoint.category,
      categoryName: endpoint.categoryName,
      name: endpoint.name,
      method: endpoint.method,
      path: endpoint.path,
      summary: endpoint.summary,
      description: endpoint.description,
      minPlan: endpoint.minPlan,
      public: Boolean(endpoint.public),
      params: endpoint.params,
      response: endpoint.response,
      examples: buildExamples(endpoint, app.url),
    }));

    const settings = await store.getSettings();
    res.render('docs', {
      title: `Dokumentasi API — ${app.name}`,
      description: 'Dokumentasi endpoint, parameter, contoh kode, dan tester API.',
      bodyClass: 'page-docs',
      settings,
      categories,
      endpoints: clientEndpoints,
      docsData: {
        baseUrl: app.url,
        endpoints: clientEndpoints,
        categories,
        user: req.user
          ? {
              username: req.user.username,
              plan: req.user.plan,
              apiKeyMasked: storeKeyMask(req.user),
              hasKey: Boolean(req.user.apiKeyHash),
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', (req, res) => {
  const endpoint = endpoints.find((item) => item.id === req.params.id);
  if (!endpoint) return res.redirect('/docs');
  return res.redirect(`/docs#ep-${endpoint.id}`);
});

function storeKeyMask(user) {
  return user.apiKeyLast4 ? `nusa_••••••••••••${user.apiKeyLast4}` : 'Belum ada API key';
}

module.exports = router;
