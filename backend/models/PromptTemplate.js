const mongoose = require('mongoose');

const promptTemplateSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 80 },
    prompt: { type: String, required: true, maxlength: 4000 },
    mode: { type: String, default: 'general' },
    category: { type: String, default: 'General' },
  },
  { timestamps: true }
);

const PromptTemplate = mongoose.model('PromptTemplate', promptTemplateSchema);

const DEFAULTS = [
  { title: 'Debug my code', mode: 'code', category: 'Coding', prompt: 'Find and fix the bugs in this code. Show before vs after:\n\n```\n// paste code here\n```' },
  { title: 'Explain this code', mode: 'code', category: 'Coding', prompt: 'Explain what this code does line by line, then suggest improvements:\n\n' },
  { title: 'REST API in Express', mode: 'code', category: 'Coding', prompt: 'Write a production-ready Express.js REST API with CRUD routes for a "products" resource using MongoDB.' },
  { title: 'YouTube thumbnail', mode: 'image', category: 'Images', prompt: 'Bold YouTube thumbnail, shocked tech reviewer holding a glowing smartphone, vibrant orange and blue background, high contrast, 16:9' },
  { title: 'Product photo', mode: 'image', category: 'Images', prompt: 'Minimal studio product photo of a ceramic coffee mug on a pastel background, soft shadows, 4k' },
  { title: 'SEO blog post', mode: 'writer', category: 'Writing', prompt: 'Write a 1,200-word SEO-optimised blog post about "[topic]" with H2/H3 headings, an intro hook, FAQs and a meta description.' },
  { title: 'Social media pack', mode: 'writer', category: 'Writing', prompt: 'Create 5 LinkedIn posts, 5 tweets and 3 Instagram captions announcing: [your announcement].' },
  { title: 'Summarise a PDF', mode: 'document', category: 'Documents', prompt: 'Summarise the attached document in 10 bullet points, then list key figures and action items.' },
  { title: 'Summarise a web page', mode: 'url', category: 'Web', prompt: 'Summarise this page and list its main takeaways: https://' },
];

async function seedTemplates() {
  const count = await PromptTemplate.estimatedDocumentCount();
  if (count === 0) {
    await PromptTemplate.insertMany(DEFAULTS);
    console.log('[seed] default prompt templates inserted');
  }
}

module.exports = PromptTemplate;
module.exports.seedTemplates = seedTemplates;
