from transformers import pipeline

generator = pipeline('text-generation', model='gpt2')


output = generator("Hello, I'm a language model", max_length=30, num_return_sequences=1)
print(output[0]['generated_text']) 
