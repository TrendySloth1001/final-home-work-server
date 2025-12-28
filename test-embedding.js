const { embeddingService } = require('./dist/shared/lib/embeddings');

(async () => {
  try {
    console.log('Testing embedding generation...');
    const vector = await embeddingService.generateEmbedding('What is photosynthesis?');
    console.log('✅ Embedding generated successfully');
    console.log('Vector length:', vector.length);
    console.log('First 5 values:', vector.slice(0, 5));
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  process.exit(0);
})();
