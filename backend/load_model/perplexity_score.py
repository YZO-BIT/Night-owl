import lmppl


scorer = lmppl.LM("gpt2")


text = [
    "I love natural language processing.",
    "This sentence might be AI-generated."
]


ppl = scorer.get_perplexity(text)
print(list(zip(text, ppl)))  