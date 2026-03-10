import credits.aleo;

program ppv_pay_v2_xwnxp.aleo {
    @admin(address = "aleo179k9x8m793zgxv5x5w00huef7q73uw0jfne6mtcgu574n5leuczqjd43yl")
    async constructor() {}

    record ContentAccess {
        owner: address,
        content_id: field,
    }

    // buy_content transfers `price` microcredits from caller to `creator_address`,
    // then mints a private ContentAccess record proving ownership.
    async transition buy_content(
        public content_id: field,
        public creator_address: address,
        public price: u64,
    ) -> (ContentAccess, Future) {
        assert(price > 0u64);
        let fut: Future = credits.aleo/transfer_public(creator_address, price);
        return (
            ContentAccess {
                owner: self.signer,
                content_id: content_id,
            },
            finalize_buy_content(fut),
        );
    }

    async function finalize_buy_content(f: Future) {
        f.await();
    }

    transition prove_content_access(access: ContentAccess, public content_id: field) -> bool {
        assert_eq(access.owner, self.signer);
        assert_eq(access.content_id, content_id);
        return true;
    }
}
