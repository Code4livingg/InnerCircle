import credits.aleo;
import test_usdcx_stablecoin.aleo;

program tip_pay_v4_xwnxp.aleo {
    @admin(address = "aleo1jvs27kq44uzn8ry5st8mrj6f2cjef93hst7p6ft0rq86gqg8w59q3vw492")
    async constructor() {}

    mapping tip_totals: field => u64;

    record TipReceipt {
        owner: address,
        creator_id: field,
        amount: u64,
    }

    // Anonymous tip from a private balance. The creator receives a private credits record.
    transition tip_private(
        public creator_id: field,
        public creator_address: address,
        public amount: u64,
        private payment: credits.aleo/credits,
    ) -> (credits.aleo/credits, credits.aleo/credits, TipReceipt) {
        assert(amount > 0u64);
        let (change, tip_record) = credits.aleo/transfer_private(payment, creator_address, amount);
        return (
            change,
            tip_record,
            TipReceipt {
                owner: self.signer,
                creator_id: creator_id,
                amount: amount,
            },
        );
    }

    async transition tip_public(
        public creator_id: field,
        public creator_address: address,
        public amount: u64,
    ) -> (TipReceipt, Future) {
        assert(amount > 0u64);
        let fut: Future = credits.aleo/transfer_public(creator_address, amount);
        return (
            TipReceipt {
                owner: self.signer,
                creator_id: creator_id,
                amount: amount,
            },
            finalize_tip_public(fut, creator_id, amount),
        );
    }

    async function finalize_tip_public(
        f: Future,
        public creator_id: field,
        public amount: u64,
    ) {
        f.await();
        let current: u64 = tip_totals.get_or_use(creator_id, 0u64);
        tip_totals.set(creator_id, current + amount);
    }

    transition prove_tip(
        receipt: TipReceipt,
        public creator_id: field,
        public amount: u64,
    ) -> bool {
        assert_eq(receipt.owner, self.signer);
        assert_eq(receipt.creator_id, creator_id);
        assert_eq(receipt.amount, amount);
        return true;
    }

    async transition tip_private_v2(
        public creator_id: field,
        public creator_address: address,
        public amount: u64,
        private payment: credits.aleo/credits,
    ) -> (credits.aleo/credits, credits.aleo/credits, TipReceipt, Future) {
        assert(amount > 0u64);
        let (change, tip_record) = credits.aleo/transfer_private(payment, creator_address, amount);
        return (
            change,
            tip_record,
            TipReceipt {
                owner: self.signer,
                creator_id: creator_id,
                amount: amount,
            },
            finalize_tip_private_v2(creator_id, amount),
        );
    }

    async function finalize_tip_private_v2(public creator_id: field, public amount: u64) {
        let current: u64 = tip_totals.get_or_use(creator_id, 0u64);
        tip_totals.set(creator_id, current + amount);
    }

    async transition tip_private_usdcx(
        public creator_id: field,
        public creator_address: address,
        public amount: u128,
        private payment: test_usdcx_stablecoin.aleo/Token,
        private proofs: [test_usdcx_stablecoin.aleo/MerkleProof; 2],
    ) -> (
        test_usdcx_stablecoin.aleo/Token,
        test_usdcx_stablecoin.aleo/Token,
        test_usdcx_stablecoin.aleo/ComplianceRecord,
        TipReceipt,
        Future
    ) {
        assert(amount > 0u128);
        let amount_u64: u64 = amount as u64;
        let (compliance_record, creator_record, change_record, transfer_future): (
            test_usdcx_stablecoin.aleo/ComplianceRecord,
            test_usdcx_stablecoin.aleo/Token,
            test_usdcx_stablecoin.aleo/Token,
            Future
        ) = test_usdcx_stablecoin.aleo/transfer_private(creator_address, amount, payment, proofs);

        return (
            creator_record,
            change_record,
            compliance_record,
            TipReceipt {
                owner: self.signer,
                creator_id: creator_id,
                amount: amount_u64,
            },
            finalize_tip_private_usdcx(transfer_future, creator_id, amount_u64),
        );
    }

    async function finalize_tip_private_usdcx(
        f: Future,
        public creator_id: field,
        public amount: u64,
    ) {
        f.await();
        let current: u64 = tip_totals.get_or_use(creator_id, 0u64);
        tip_totals.set(creator_id, current + amount);
    }

    async transition tip_public_usdcx(
        public creator_id: field,
        public creator_address: address,
        public amount: u128,
    ) -> (TipReceipt, Future) {
        assert(amount > 0u128);
        let amount_u64: u64 = amount as u64;
        let fut: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(creator_address, amount);
        return (
            TipReceipt {
                owner: self.signer,
                creator_id: creator_id,
                amount: amount_u64,
            },
            finalize_tip_public_usdcx(fut, creator_id, amount_u64),
        );
    }

    async function finalize_tip_public_usdcx(
        f: Future,
        public creator_id: field,
        public amount: u64,
    ) {
        f.await();
        let current: u64 = tip_totals.get_or_use(creator_id, 0u64);
        tip_totals.set(creator_id, current + amount);
    }

    transition prove_tip_v2(
        receipt: TipReceipt,
        public creator_id: field,
        public amount: u64,
    ) -> (bool, TipReceipt) {
        assert_eq(receipt.owner, self.signer);
        assert_eq(receipt.creator_id, creator_id);
        assert_eq(receipt.amount, amount);
        return (true, receipt);
    }
}
