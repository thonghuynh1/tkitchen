const plugin = {
  meta: {
    name: "tkitchen",
  },
  rules: {
    "no-comments": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow comments.",
        },
        schema: [],
        messages: {
          comment: "Comments are not allowed.",
        },
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              if (comment.type === "Shebang") continue;
              context.report({
                node: comment,
                messageId: "comment",
              });
            }
          },
        };
      },
    },
  },
};

export default plugin;
